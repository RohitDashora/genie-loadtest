import asyncio
import random
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from backend.db import get_cursor, get_db
from backend.genie_client import GenieClient


STALE_RUN_TTL = 300  # seconds — evict completed runs after 5 min as safety net


class TestEngine:
    """Manages load test execution with virtual users."""

    def __init__(self):
        self.active_runs: dict[str, dict] = {}
        self._completed_at: dict[str, float] = {}

    def get_run_status(self, run_id: str) -> Optional[dict]:
        return self.active_runs.get(run_id)

    def cleanup_run(self, run_id: str):
        """Remove a completed run from in-memory tracking."""
        self.active_runs.pop(run_id, None)
        self._completed_at.pop(run_id, None)

    def _sweep_stale_runs(self):
        """Evict runs that completed more than STALE_RUN_TTL seconds ago."""
        now = time.time()
        stale = [
            rid for rid, t in self._completed_at.items()
            if now - t > STALE_RUN_TTL
        ]
        for rid in stale:
            self.cleanup_run(rid)

    async def start_test(
        self,
        run_id: str,
        genie_space_id: str,
        num_users: int,
        questions_per_user: int,
        think_time_min: float,
        think_time_max: float,
        max_retries: int = 5,
        retry_base_delay: float = 2.0,
        poll_interval: float = 2.0,
        max_poll_time: float = 300,
    ):
        """Launch a load test with N virtual users."""
        self._sweep_stale_runs()
        genie = GenieClient(max_retries=max_retries, retry_base_delay=retry_base_delay, poll_interval=poll_interval, max_poll_time=max_poll_time)
        questions = self._load_questions(genie_space_id)
        if not questions:
            self._update_run_status(run_id, "failed")
            self.active_runs[run_id] = {
                "status": "failed",
                "error": "No questions in question bank for this space",
            }
            return

        self.active_runs[run_id] = {
            "status": "running",
            "total": num_users * questions_per_user,
            "completed": 0,
            "successful": 0,
            "failed": 0,
            "results": [],
        }

        tasks = []
        for user_id in range(num_users):
            task = asyncio.create_task(
                self._run_virtual_user(
                    run_id=run_id,
                    user_id=user_id,
                    genie_space_id=genie_space_id,
                    questions=questions,
                    questions_per_user=questions_per_user,
                    think_time_min=think_time_min,
                    think_time_max=think_time_max,
                    genie=genie,
                )
            )
            tasks.append(task)
            # Stagger user starts by 1-2 seconds to avoid thundering herd
            await asyncio.sleep(random.uniform(0.5, 2.0))

        await asyncio.gather(*tasks, return_exceptions=True)

        run_state = self.active_runs.get(run_id, {})
        if run_state.get("status") != "cancelled":
            run_state["status"] = "completed"
            self._update_run_status(run_id, "completed")
        self._completed_at[run_id] = time.time()

    async def _run_virtual_user(
        self,
        run_id: str,
        user_id: int,
        genie_space_id: str,
        questions: list[str],
        questions_per_user: int,
        think_time_min: float,
        think_time_max: float,
        genie: GenieClient = None,
    ):
        """Simulate a single user: start conversation, then send messages."""
        run_state = self.active_runs.get(run_id)
        if not run_state:
            return

        shuffled = random.sample(questions, min(len(questions), questions_per_user))
        if len(shuffled) < questions_per_user:
            shuffled = shuffled * (questions_per_user // len(shuffled) + 1)
            shuffled = shuffled[:questions_per_user]

        conversation_id = None

        for i, question in enumerate(shuffled):
            if run_state.get("status") == "cancelled":
                return

            request_id = str(uuid.uuid4())
            started_at = datetime.now(timezone.utc)

            try:
                if i == 0:
                    result = await genie.start_conversation(
                        genie_space_id, question
                    )
                    conversation_id = result.get("conversation_id")
                    request_type = "start_conversation"
                elif not conversation_id:
                    # start_conversation failed, skip remaining messages
                    latency_ms = 0
                    status = "error"
                    error = "Skipped: start_conversation failed, no conversation_id"
                    http_status = None
                    first_response_at = None
                    completed_at = datetime.now(timezone.utc)
                    request_type = "create_message"
                    # Record and continue to next question
                    self._record_request(
                        request_id=request_id, run_id=run_id,
                        virtual_user_id=user_id, question=question,
                        conversation_id=None, request_type=request_type,
                        started_at=started_at, first_response_at=None,
                        completed_at=completed_at, latency_ms=0,
                        ttfr_ms=None, polling_ms=None,
                        status="error", error_message=error, http_status_code=None,
                        retry_count=0, backoff_time_ms=0,
                        response_type="error",
                    )
                    run_state["completed"] += 1
                    run_state["failed"] += 1
                    run_state["results"].append({
                        "request_id": request_id, "user_id": user_id,
                        "question": question[:80], "request_type": request_type,
                        "latency_ms": 0, "status": "error",
                        "timestamp": completed_at.isoformat(),
                    })
                    continue
                else:
                    result = await genie.create_message(
                        genie_space_id, conversation_id, question
                    )
                    request_type = "create_message"

                latency_ms = (result["completed_time"] - result["start_time"]) * 1000
                ttfr_ms = (result["first_response_time"] - result["start_time"]) * 1000
                polling_ms = (result["completed_time"] - result["first_response_time"]) * 1000
                retry_count = result.get("retry_count", 0)
                backoff_time_ms = result.get("backoff_time_ms", 0)
                status = result.get("status", "error")
                error = result.get("error")
                http_status = result.get("http_status")
                response_type = result.get("response_type")
                first_response_at = datetime.fromtimestamp(
                    result["first_response_time"], tz=timezone.utc
                )
                completed_at = datetime.fromtimestamp(
                    result["completed_time"], tz=timezone.utc
                )

            except Exception as e:
                latency_ms = (time.time() - started_at.timestamp()) * 1000
                ttfr_ms = None
                polling_ms = None
                retry_count = 0
                backoff_time_ms = 0
                status = "error"
                error = str(e)[:500]
                http_status = None
                response_type = "error"
                first_response_at = None
                completed_at = datetime.now(timezone.utc)
                request_type = "start_conversation" if i == 0 else "create_message"

            self._record_request(
                request_id=request_id,
                run_id=run_id,
                virtual_user_id=user_id,
                question=question,
                conversation_id=conversation_id,
                request_type=request_type,
                started_at=started_at,
                first_response_at=first_response_at,
                completed_at=completed_at,
                latency_ms=latency_ms,
                ttfr_ms=ttfr_ms,
                polling_ms=polling_ms,
                status=status,
                error_message=error,
                http_status_code=http_status,
                retry_count=retry_count,
                backoff_time_ms=backoff_time_ms,
                response_type=response_type,
            )

            is_success = status == "completed"
            run_state["completed"] += 1
            if is_success:
                run_state["successful"] += 1
            else:
                run_state["failed"] += 1
            run_state["results"].append(
                {
                    "request_id": request_id,
                    "user_id": user_id,
                    "question": question[:80],
                    "request_type": request_type,
                    "latency_ms": round(latency_ms, 1),
                    "status": status,
                    "timestamp": completed_at.isoformat() if completed_at else None,
                }
            )

            if i < len(shuffled) - 1:
                wait = random.uniform(think_time_min, think_time_max)
                await asyncio.sleep(wait)

    def _load_questions(self, genie_space_id: str) -> list[str]:
        with get_cursor() as cur:
            cur.execute(
                "SELECT question FROM question_bank WHERE genie_space_id = %s",
                (genie_space_id,),
            )
            return [row["question"] for row in cur.fetchall()]

    def _record_request(self, **kwargs):
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO test_requests (
                    request_id, run_id, virtual_user_id, question,
                    conversation_id, request_type, started_at,
                    first_response_at, completed_at, latency_ms,
                    ttfr_ms, polling_ms,
                    status, error_message, http_status_code,
                    retry_count, backoff_time_ms, response_type
                ) VALUES (
                    %(request_id)s, %(run_id)s, %(virtual_user_id)s, %(question)s,
                    %(conversation_id)s, %(request_type)s, %(started_at)s,
                    %(first_response_at)s, %(completed_at)s, %(latency_ms)s,
                    %(ttfr_ms)s, %(polling_ms)s,
                    %(status)s, %(error_message)s, %(http_status_code)s,
                    %(retry_count)s, %(backoff_time_ms)s, %(response_type)s
                )
                """,
                kwargs,
            )
            conn.commit()

    def _update_run_status(self, run_id: str, status: str):
        with get_db() as conn:
            if status in ("completed", "failed", "cancelled"):
                conn.execute(
                    """
                    UPDATE test_runs
                    SET status = %s,
                        completed_at = NOW(),
                        total_requests = (SELECT COUNT(*) FROM test_requests WHERE run_id = %s),
                        successful_requests = (SELECT COUNT(*) FROM test_requests WHERE run_id = %s AND status = 'completed'),
                        failed_requests = (SELECT COUNT(*) FROM test_requests WHERE run_id = %s AND status != 'completed')
                    WHERE run_id = %s
                    """,
                    (status, run_id, run_id, run_id, run_id),
                )
            else:
                conn.execute(
                    "UPDATE test_runs SET status = %s WHERE run_id = %s",
                    (status, run_id),
                )
            conn.commit()

    def cancel_test(self, run_id: str):
        run_state = self.active_runs.get(run_id)
        if run_state:
            run_state["status"] = "cancelled"
            self._update_run_status(run_id, "cancelled")
