#!/usr/bin/env python3
"""
Genie Load Tester — Standalone CLI

Benchmark Databricks Genie API concurrency and latency from the command line.
No Lakebase, no web UI, no Databricks App required — just Python + two packages.

Usage:
    pip install databricks-sdk httpx
    python genie_loadtest_cli.py --space-id <ID> --questions questions.txt --profile my-profile
"""

import argparse
import asyncio
import csv
import logging
import random
import signal
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone

import httpx
from databricks.sdk import WorkspaceClient

logger = logging.getLogger("genie-loadtest-cli")

# ---------------------------------------------------------------------------
# Genie API Client (adapted from backend/genie_client.py)
# ---------------------------------------------------------------------------

class GenieClient:
    """Client for Databricks Genie API using databricks-sdk profile auth."""

    def __init__(self, profile=None, max_retries=5, retry_base_delay=2.0,
                 poll_interval=2.0, max_poll_time=300):
        self.w = WorkspaceClient(profile=profile)
        self.base_url = f"{self.w.config.host}/api/2.0/genie/spaces"
        self.poll_interval = poll_interval
        self.max_poll_time = max_poll_time
        self.max_retries = max_retries
        self.retry_base_delay = retry_base_delay

    def _headers(self):
        token = self.w.config.authenticate()
        return {**token, "Content-Type": "application/json"}

    async def _request_with_retry(self, client, method, url, **kwargs):
        """HTTP request with exponential backoff on 429s.
        Returns (response, retry_count, backoff_time_ms)."""
        total_retries = 0
        total_backoff = 0.0
        for attempt in range(self.max_retries):
            resp = await getattr(client, method)(url, headers=self._headers(), **kwargs)
            if resp.status_code == 429:
                retry_after = self.retry_base_delay * (2 ** attempt)
                logger.warning(f"429 on {url}, retry {attempt+1}/{self.max_retries} after {retry_after:.1f}s")
                total_retries += 1
                total_backoff += retry_after * 1000
                await asyncio.sleep(retry_after)
                continue
            resp.raise_for_status()
            return resp, total_retries, total_backoff
        resp = await getattr(client, method)(url, headers=self._headers(), **kwargs)
        resp.raise_for_status()
        return resp, total_retries, total_backoff

    async def start_conversation(self, space_id, question):
        url = f"{self.base_url}/{space_id}/start-conversation"
        start_time = time.time()
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp, retries, backoff = await self._request_with_retry(
                client, "post", url, json={"content": question}
            )
            data = resp.json()

        conversation_id = data.get("conversation_id", "")
        message_id = data.get("message_id", "")
        first_response_time = time.time()

        result = await self._poll_message(space_id, conversation_id, message_id, first_response_time)
        result["start_time"] = start_time
        result["first_response_time"] = first_response_time
        result["conversation_id"] = conversation_id
        result["message_id"] = message_id
        result["http_status"] = resp.status_code
        result["retry_count"] = retries + result.get("poll_retries", 0)
        result["backoff_time_ms"] = backoff + result.get("poll_backoff_ms", 0)
        return result

    async def create_message(self, space_id, conversation_id, question):
        url = f"{self.base_url}/{space_id}/conversations/{conversation_id}/messages"
        start_time = time.time()
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp, retries, backoff = await self._request_with_retry(
                client, "post", url, json={"content": question}
            )
            data = resp.json()

        message_id = data.get("id", "")
        first_response_time = time.time()

        result = await self._poll_message(space_id, conversation_id, message_id, first_response_time)
        result["start_time"] = start_time
        result["first_response_time"] = first_response_time
        result["conversation_id"] = conversation_id
        result["message_id"] = message_id
        result["http_status"] = resp.status_code
        result["retry_count"] = retries + result.get("poll_retries", 0)
        result["backoff_time_ms"] = backoff + result.get("poll_backoff_ms", 0)
        return result

    async def _poll_message(self, space_id, conversation_id, message_id, poll_start):
        url = (f"{self.base_url}/{space_id}/conversations/"
               f"{conversation_id}/messages/{message_id}")
        terminal_states = {"COMPLETED", "FAILED", "CANCELLED", "EXPIRED"}
        poll_retries = 0
        poll_backoff_ms = 0.0

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                if time.time() - poll_start > self.max_poll_time:
                    return {
                        "completed_time": time.time(), "status": "timeout",
                        "error": f"Polling timeout after {self.max_poll_time}s",
                        "poll_retries": poll_retries, "poll_backoff_ms": poll_backoff_ms,
                    }
                try:
                    resp, retries, backoff = await self._request_with_retry(client, "get", url)
                    poll_retries += retries
                    poll_backoff_ms += backoff
                    data = resp.json()
                    status = data.get("status", "UNKNOWN")
                    if status in terminal_states:
                        error = None
                        if status != "COMPLETED":
                            error = data.get("error", {}).get("message", f"Message {status}")
                        return {
                            "completed_time": time.time(), "status": status.lower(),
                            "error": error, "response_type": status.lower(),
                            "poll_retries": poll_retries, "poll_backoff_ms": poll_backoff_ms,
                        }
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 429:
                        poll_retries += 1
                        poll_backoff_ms += self.retry_base_delay * 1000
                        await asyncio.sleep(self.retry_base_delay)
                        continue
                    return {
                        "completed_time": time.time(), "status": "error",
                        "error": f"HTTP {e.response.status_code}: {e.response.text[:200]}",
                        "poll_retries": poll_retries, "poll_backoff_ms": poll_backoff_ms,
                    }
                except Exception as e:
                    return {
                        "completed_time": time.time(), "status": "error",
                        "error": str(e)[:200],
                        "poll_retries": poll_retries, "poll_backoff_ms": poll_backoff_ms,
                    }
                await asyncio.sleep(self.poll_interval)


# ---------------------------------------------------------------------------
# Question loader
# ---------------------------------------------------------------------------

def load_questions(path):
    with open(path) as f:
        return [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]


# ---------------------------------------------------------------------------
# Progress bar
# ---------------------------------------------------------------------------

class ProgressBar:
    def __init__(self, total):
        self.total = total
        self.completed = 0
        self.successful = 0
        self.failed = 0
        self._latencies = []
        self._lock = asyncio.Lock()

    async def update(self, latency_ms, success):
        async with self._lock:
            self.completed += 1
            if success:
                self.successful += 1
            else:
                self.failed += 1
            if latency_ms and latency_ms > 0:
                self._latencies.append(latency_ms)
            self._render()

    def _render(self):
        pct = self.completed / self.total if self.total else 0
        bar_len = 20
        filled = int(bar_len * pct)
        bar = "\u2588" * filled + "\u2591" * (bar_len - filled)
        avg_s = (statistics.mean(self._latencies) / 1000) if self._latencies else 0
        sys.stderr.write(
            f"\r[{self.completed}/{self.total}] {pct:>4.0%} {bar} "
            f"success={self.successful} failed={self.failed} avg={avg_s:.1f}s"
        )
        sys.stderr.flush()

    def finish(self):
        sys.stderr.write("\n")
        sys.stderr.flush()


# ---------------------------------------------------------------------------
# Virtual user (adapted from backend/test_engine.py)
# ---------------------------------------------------------------------------

async def run_virtual_user(user_id, genie_space_id, questions, questions_per_user,
                           think_time_min, think_time_max, genie, results, progress,
                           cancelled):
    shuffled = random.sample(questions, min(len(questions), questions_per_user))
    if len(shuffled) < questions_per_user:
        shuffled = shuffled * (questions_per_user // len(shuffled) + 1)
        shuffled = shuffled[:questions_per_user]

    conversation_id = None

    for i, question in enumerate(shuffled):
        if cancelled.is_set():
            return

        request_id = str(uuid.uuid4())
        started_at = datetime.now(timezone.utc)

        try:
            if i == 0:
                result = await genie.start_conversation(genie_space_id, question)
                conversation_id = result.get("conversation_id")
                request_type = "start_conversation"
            elif not conversation_id:
                completed_at = datetime.now(timezone.utc)
                rec = {
                    "request_id": request_id, "virtual_user_id": user_id,
                    "question": question, "conversation_id": None,
                    "request_type": "create_message",
                    "started_at": started_at.isoformat(),
                    "first_response_at": None, "completed_at": completed_at.isoformat(),
                    "latency_ms": 0, "ttfr_ms": None, "polling_ms": None,
                    "status": "error",
                    "error_message": "Skipped: start_conversation failed, no conversation_id",
                    "http_status_code": None, "retry_count": 0,
                    "backoff_time_ms": 0, "response_type": "error",
                }
                results.append(rec)
                await progress.update(0, False)
                continue
            else:
                result = await genie.create_message(genie_space_id, conversation_id, question)
                request_type = "create_message"

            latency_ms = (result["completed_time"] - result["start_time"]) * 1000
            ttfr_ms = (result["first_response_time"] - result["start_time"]) * 1000
            polling_ms = (result["completed_time"] - result["first_response_time"]) * 1000
            status = result.get("status", "error")
            error = result.get("error")
            http_status = result.get("http_status")
            response_type = result.get("response_type")
            retry_count = result.get("retry_count", 0)
            backoff_time_ms = result.get("backoff_time_ms", 0)
            first_response_at = datetime.fromtimestamp(result["first_response_time"], tz=timezone.utc)
            completed_at = datetime.fromtimestamp(result["completed_time"], tz=timezone.utc)

        except Exception as e:
            latency_ms = (time.time() - started_at.timestamp()) * 1000
            ttfr_ms = None
            polling_ms = None
            status = "error"
            error = str(e)[:500]
            http_status = None
            response_type = "error"
            retry_count = 0
            backoff_time_ms = 0
            first_response_at = None
            completed_at = datetime.now(timezone.utc)
            request_type = "start_conversation" if i == 0 else "create_message"

        rec = {
            "request_id": request_id, "virtual_user_id": user_id,
            "question": question, "conversation_id": conversation_id,
            "request_type": request_type,
            "started_at": started_at.isoformat(),
            "first_response_at": first_response_at.isoformat() if first_response_at else None,
            "completed_at": completed_at.isoformat() if completed_at else None,
            "latency_ms": round(latency_ms, 1),
            "ttfr_ms": round(ttfr_ms, 1) if ttfr_ms is not None else None,
            "polling_ms": round(polling_ms, 1) if polling_ms is not None else None,
            "status": status, "error_message": error,
            "http_status_code": http_status, "retry_count": retry_count,
            "backoff_time_ms": round(backoff_time_ms, 1), "response_type": response_type,
        }
        results.append(rec)
        await progress.update(latency_ms, status == "completed")

        if i < len(shuffled) - 1:
            await asyncio.sleep(random.uniform(think_time_min, think_time_max))


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def run_load_test(args, questions):
    genie = GenieClient(
        profile=args.profile,
        max_retries=args.max_retries,
        retry_base_delay=args.retry_base_delay,
        poll_interval=args.poll_interval,
        max_poll_time=args.max_poll_time,
    )

    total = args.users * args.questions_per_user
    results = []
    progress = ProgressBar(total)
    cancelled = asyncio.Event()

    loop = asyncio.get_running_loop()
    original_handler = signal.getsignal(signal.SIGINT)

    def _cancel_handler(sig, frame):
        sys.stderr.write("\n\nCancelling... waiting for in-flight requests to finish.\n")
        cancelled.set()
        signal.signal(signal.SIGINT, original_handler)

    signal.signal(signal.SIGINT, _cancel_handler)

    tasks = []
    for user_id in range(args.users):
        task = asyncio.create_task(
            run_virtual_user(
                user_id=user_id,
                genie_space_id=args.space_id,
                questions=questions,
                questions_per_user=args.questions_per_user,
                think_time_min=args.think_time_min,
                think_time_max=args.think_time_max,
                genie=genie,
                results=results,
                progress=progress,
                cancelled=cancelled,
            )
        )
        tasks.append(task)
        await asyncio.sleep(random.uniform(0.5, 2.0))

    await asyncio.gather(*tasks, return_exceptions=True)
    progress.finish()
    signal.signal(signal.SIGINT, original_handler)

    return results, cancelled.is_set()


# ---------------------------------------------------------------------------
# Analytics (replaces SQL aggregations from main.py)
# ---------------------------------------------------------------------------

def _percentiles(values, quantiles=(0.30, 0.50, 0.60, 0.80, 0.90, 0.99)):
    """Compute percentiles using linear interpolation (matches Postgres PERCENTILE_CONT)."""
    if not values:
        return {f"p{int(q*100)}": None for q in quantiles}
    s = sorted(values)
    result = {}
    for q in quantiles:
        idx = q * (len(s) - 1)
        lo = int(idx)
        hi = min(lo + 1, len(s) - 1)
        frac = idx - lo
        result[f"p{int(q*100)}"] = round(s[lo] + (s[hi] - s[lo]) * frac, 1)
    return result


def _group_stats(records):
    """Compute stats for a list of request records."""
    latencies = [r["latency_ms"] for r in records if r["latency_ms"] is not None and r["latency_ms"] > 0]
    ttfrs = [r["ttfr_ms"] for r in records if r["ttfr_ms"] is not None]
    pollings = [r["polling_ms"] for r in records if r["polling_ms"] is not None]

    total = len(records)
    successful = sum(1 for r in records if r["status"] == "completed")
    failed = total - successful

    stats = {
        "total": total, "successful": successful, "failed": failed,
        "avg_ms": round(statistics.mean(latencies), 1) if latencies else None,
        "stddev_ms": round(statistics.stdev(latencies), 1) if len(latencies) >= 2 else None,
        "min_ms": round(min(latencies), 1) if latencies else None,
        "max_ms": round(max(latencies), 1) if latencies else None,
        "avg_ttfr_ms": round(statistics.mean(ttfrs), 1) if ttfrs else None,
        "avg_polling_ms": round(statistics.mean(pollings), 1) if pollings else None,
        "total_retries": sum(r.get("retry_count", 0) or 0 for r in records),
        "total_backoff_ms": round(sum(r.get("backoff_time_ms", 0) or 0 for r in records), 1),
    }
    stats.update(_percentiles(latencies))
    return stats


def compute_summary(results):
    if not results:
        return {}

    overall = _group_stats(results)

    by_type = {}
    for r in results:
        rt = r["request_type"]
        by_type.setdefault(rt, []).append(r)
    by_type_stats = {rt: _group_stats(recs) for rt, recs in by_type.items()}

    by_question = {}
    for r in results:
        q = r["question"]
        by_question.setdefault(q, []).append(r)
    per_question = {}
    for q, recs in by_question.items():
        s = _group_stats(recs)
        s["question"] = q
        s["times_asked"] = len(recs)
        per_question[q] = s

    by_user = {}
    for r in results:
        uid = r["virtual_user_id"]
        by_user.setdefault(uid, []).append(r)
    per_user = {uid: _group_stats(recs) for uid, recs in sorted(by_user.items())}

    timestamps = []
    for r in results:
        if r.get("started_at"):
            timestamps.append(r["started_at"])
        if r.get("completed_at"):
            timestamps.append(r["completed_at"])

    duration_sec = None
    if len(timestamps) >= 2:
        ts = sorted(timestamps)
        t0 = datetime.fromisoformat(ts[0])
        t1 = datetime.fromisoformat(ts[-1])
        duration_sec = round((t1 - t0).total_seconds(), 1)

    total_requests = len(results)
    successful = sum(1 for r in results if r["status"] == "completed")
    rpm = round(total_requests / (duration_sec / 60), 2) if duration_sec and duration_sec > 0 else None

    throughput = {
        "total_requests": total_requests,
        "successful": successful,
        "failed": total_requests - successful,
        "duration_sec": duration_sec,
        "requests_per_min": rpm,
        "success_rate_pct": round(100 * successful / total_requests, 1) if total_requests else None,
        "total_backoff_ms": overall["total_backoff_ms"],
    }

    return {
        "overall": overall,
        "by_type": by_type_stats,
        "per_question": per_question,
        "per_user": per_user,
        "throughput": throughput,
    }


# ---------------------------------------------------------------------------
# CSV writers
# ---------------------------------------------------------------------------

REQUEST_COLUMNS = [
    "request_id", "virtual_user_id", "question", "conversation_id",
    "request_type", "started_at", "first_response_at", "completed_at",
    "latency_ms", "ttfr_ms", "polling_ms", "status", "error_message",
    "http_status_code", "retry_count", "backoff_time_ms", "response_type",
]


def write_requests_csv(results, path):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=REQUEST_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(results)


def write_summary_csv(summary, path):
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)

        writer.writerow(["OVERALL"])
        o = summary["overall"]
        writer.writerow(["metric", "value"])
        for k in ["total", "successful", "failed", "avg_ms", "stddev_ms",
                   "p30", "p50", "p60", "p80", "p90", "p99", "min_ms", "max_ms",
                   "avg_ttfr_ms", "avg_polling_ms", "total_retries", "total_backoff_ms"]:
            writer.writerow([k, o.get(k)])
        writer.writerow([])

        writer.writerow(["BY REQUEST TYPE"])
        type_keys = ["total", "successful", "failed", "avg_ms", "stddev_ms",
                      "p30", "p50", "p60", "p80", "p90", "p99", "min_ms", "max_ms",
                      "avg_ttfr_ms", "avg_polling_ms"]
        writer.writerow(["request_type"] + type_keys)
        for rt, s in summary["by_type"].items():
            writer.writerow([rt] + [s.get(k) for k in type_keys])
        writer.writerow([])

        writer.writerow(["THROUGHPUT"])
        t = summary["throughput"]
        writer.writerow(["metric", "value"])
        for k in ["total_requests", "successful", "failed", "duration_sec",
                   "requests_per_min", "success_rate_pct", "total_backoff_ms"]:
            writer.writerow([k, t.get(k)])
        writer.writerow([])

        writer.writerow(["PER QUESTION"])
        pq_keys = ["times_asked", "successful", "failed", "avg_ms", "stddev_ms",
                    "p50", "p90", "min_ms", "max_ms", "avg_ttfr_ms", "avg_polling_ms",
                    "total_retries"]
        writer.writerow(["question"] + pq_keys)
        for q, s in sorted(summary["per_question"].items(), key=lambda x: -(x[1].get("avg_ms") or 0)):
            writer.writerow([q] + [s.get(k) for k in pq_keys])
        writer.writerow([])

        writer.writerow(["PER USER"])
        pu_keys = ["total", "successful", "failed", "avg_ms", "min_ms", "max_ms",
                    "avg_ttfr_ms", "avg_polling_ms", "total_retries", "total_backoff_ms"]
        writer.writerow(["virtual_user_id"] + pu_keys)
        for uid, s in summary["per_user"].items():
            writer.writerow([uid] + [s.get(k) for k in pu_keys])


# ---------------------------------------------------------------------------
# Console report
# ---------------------------------------------------------------------------

def _fmt_ms(val):
    if val is None:
        return "N/A"
    if val >= 1000:
        return f"{val/1000:.1f}s"
    return f"{val:.0f}ms"


def print_report(summary, was_cancelled):
    o = summary["overall"]
    t = summary["throughput"]

    status_label = "CANCELLED (partial results)" if was_cancelled else "COMPLETED"
    print(f"\n{'=' * 60}")
    print(f"  RESULTS — {status_label}")
    print(f"{'=' * 60}")

    print(f"\n  Overall:  {o['successful']}/{o['total']} success "
          f"({t['success_rate_pct']}%)")
    print(f"            avg={_fmt_ms(o['avg_ms'])}  "
          f"p50={_fmt_ms(o.get('p50'))}  "
          f"p90={_fmt_ms(o.get('p90'))}  "
          f"p99={_fmt_ms(o.get('p99'))}")
    if o.get("stddev_ms") is not None:
        print(f"            stddev={_fmt_ms(o['stddev_ms'])}  "
              f"min={_fmt_ms(o['min_ms'])}  max={_fmt_ms(o['max_ms'])}")

    for rt, s in summary["by_type"].items():
        label = "Start Conv" if rt == "start_conversation" else "Messages"
        print(f"\n  {label}:  {s['total']} requests, "
              f"avg={_fmt_ms(s['avg_ms'])}  "
              f"p50={_fmt_ms(s.get('p50'))}  "
              f"p90={_fmt_ms(s.get('p90'))}")
        if s.get("avg_ttfr_ms") is not None:
            print(f"            TTFR={_fmt_ms(s['avg_ttfr_ms'])}  "
                  f"Polling={_fmt_ms(s['avg_polling_ms'])}")

    print(f"\n  Throughput: {t['total_requests']} requests in "
          f"{_fmt_ms((t['duration_sec'] or 0) * 1000)} "
          f"({t['requests_per_min'] or 'N/A'} req/min)")
    print(f"  Retries:    {o['total_retries']} total, "
          f"{_fmt_ms(o['total_backoff_ms'])} backoff")
    print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(
        description="Genie Load Tester — benchmark Genie API concurrency and latency",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python genie_loadtest_cli.py --space-id 01ef... --questions questions.txt --profile my-profile
  python genie_loadtest_cli.py --space-id 01ef... --questions q.txt --users 20 --questions-per-user 10
  python genie_loadtest_cli.py --space-id 01ef... --questions q.txt --output mytest
        """,
    )
    p.add_argument("--space-id", required=True, help="Genie Space ID")
    p.add_argument("--questions", required=True, help="Path to questions file (one per line)")
    p.add_argument("--profile", default="DEFAULT", help="Databricks CLI profile name (default: DEFAULT)")
    p.add_argument("--users", type=int, default=10, help="Number of virtual users, 1-50 (default: 10)")
    p.add_argument("--questions-per-user", type=int, default=5, help="Questions each user sends, 1-50 (default: 5)")
    p.add_argument("--think-time-min", type=float, default=2.0, help="Min seconds between questions (default: 2.0)")
    p.add_argument("--think-time-max", type=float, default=10.0, help="Max seconds between questions (default: 10.0)")
    p.add_argument("--max-retries", type=int, default=5, help="Max retry attempts on 429 (default: 5)")
    p.add_argument("--retry-base-delay", type=float, default=2.0, help="Exponential backoff base in seconds (default: 2.0)")
    p.add_argument("--poll-interval", type=float, default=2.0, help="Poll frequency in seconds (default: 2.0)")
    p.add_argument("--max-poll-time", type=float, default=300, help="Max poll timeout in seconds (default: 300)")
    p.add_argument("--output", default="results", help="Output file prefix (default: results)")
    p.add_argument("--verbose", action="store_true", help="Enable debug logging")
    return p.parse_args()


def main():
    args = parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(levelname)s %(message)s")
    else:
        logging.basicConfig(level=logging.CRITICAL)

    if args.users < 1 or args.users > 50:
        sys.exit("Error: --users must be between 1 and 50")
    if args.questions_per_user < 1 or args.questions_per_user > 50:
        sys.exit("Error: --questions-per-user must be between 1 and 50")

    questions = load_questions(args.questions)
    if not questions:
        sys.exit(f"Error: no questions found in {args.questions}")

    total = args.users * args.questions_per_user
    print(f"\nGenie Load Test")
    print(f"  Space:     {args.space_id}")
    print(f"  Profile:   {args.profile}")
    print(f"  Config:    {args.users} users x {args.questions_per_user} questions = {total} requests")
    print(f"  Think:     {args.think_time_min}-{args.think_time_max}s")
    print(f"  Retry:     max {args.max_retries}, base delay {args.retry_base_delay}s")
    print(f"  Polling:   every {args.poll_interval}s, timeout {args.max_poll_time}s")
    print(f"  Questions: {len(questions)} loaded from {args.questions}")
    print()

    results, was_cancelled = asyncio.run(run_load_test(args, questions))

    if not results:
        sys.exit("No results collected.")

    summary = compute_summary(results)

    requests_path = f"{args.output}_requests.csv"
    summary_path = f"{args.output}_summary.csv"
    write_requests_csv(results, requests_path)
    write_summary_csv(summary, summary_path)

    print_report(summary, was_cancelled)
    print(f"  Output:    {requests_path}")
    print(f"             {summary_path}")
    print()


if __name__ == "__main__":
    main()
