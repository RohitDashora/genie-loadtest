import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from backend.db import init_db, get_cursor, get_db
from backend.test_engine import TestEngine

app = FastAPI(title="Genie Load Tester")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = TestEngine()


@app.on_event("startup")
def startup():
    import logging
    logger = logging.getLogger("genie-loadtest")
    try:
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.warning(f"Database init failed (will retry on first request): {e}")


# --- Models ---

class StartTestRequest(BaseModel):
    genie_space_id: str
    num_users: int = 10
    questions_per_user: int = 5
    think_time_min_sec: float = 2.0
    think_time_max_sec: float = 10.0
    max_retries: int = 5
    retry_base_delay: float = 2.0
    poll_interval_sec: float = 2.0
    max_poll_time_sec: float = 300


class QuestionCreate(BaseModel):
    genie_space_id: str
    question: str


class QuestionBulkCreate(BaseModel):
    genie_space_id: str
    questions: list[str]


# --- Test Runs ---

@app.post("/api/test/start")
async def start_test(req: StartTestRequest):
    if req.num_users < 1 or req.num_users > 50:
        raise HTTPException(400, "num_users must be between 1 and 50")
    if req.questions_per_user < 1 or req.questions_per_user > 50:
        raise HTTPException(400, "questions_per_user must be between 1 and 50")

    run_id = str(uuid.uuid4())

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO test_runs (
                run_id, genie_space_id, num_users, questions_per_user,
                think_time_min_sec, think_time_max_sec,
                max_retries, retry_base_delay,
                poll_interval_sec, max_poll_time_sec, status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'running')
            """,
            (
                run_id,
                req.genie_space_id,
                req.num_users,
                req.questions_per_user,
                req.think_time_min_sec,
                req.think_time_max_sec,
                req.max_retries,
                req.retry_base_delay,
                req.poll_interval_sec,
                req.max_poll_time_sec,
            ),
        )
        conn.commit()

    asyncio.create_task(
        engine.start_test(
            run_id=run_id,
            genie_space_id=req.genie_space_id,
            num_users=req.num_users,
            questions_per_user=req.questions_per_user,
            think_time_min=req.think_time_min_sec,
            think_time_max=req.think_time_max_sec,
            max_retries=req.max_retries,
            retry_base_delay=req.retry_base_delay,
            poll_interval=req.poll_interval_sec,
            max_poll_time=req.max_poll_time_sec,
        )
    )

    return {"run_id": run_id, "status": "running"}


@app.post("/api/test/{run_id}/cancel")
async def cancel_test(run_id: str):
    engine.cancel_test(run_id)
    return {"run_id": run_id, "status": "cancelled"}


@app.get("/api/test/{run_id}/stream")
async def stream_test_status(run_id: str):
    """SSE endpoint for live test progress."""

    async def event_generator():
        last_count = 0
        while True:
            run_state = engine.get_run_status(run_id)
            if not run_state:
                with get_cursor() as cur:
                    cur.execute(
                        "SELECT status FROM test_runs WHERE run_id = %s", (run_id,)
                    )
                    row = cur.fetchone()
                    if row and row["status"] in ("completed", "failed", "cancelled"):
                        yield {
                            "event": "done",
                            "data": json.dumps({"status": row["status"]}),
                        }
                        return
                yield {
                    "event": "error",
                    "data": json.dumps({"error": "Run not found"}),
                }
                return

            current_count = run_state.get("completed", 0)
            new_results = run_state.get("results", [])[last_count:]
            last_count = current_count

            payload = {
                "status": run_state["status"],
                "total": run_state["total"],
                "completed": current_count,
                "successful": run_state.get("successful", 0),
                "failed": run_state.get("failed", 0),
                "new_results": new_results,
            }

            yield {"event": "progress", "data": json.dumps(payload)}

            if run_state["status"] in ("completed", "failed", "cancelled"):
                yield {
                    "event": "done",
                    "data": json.dumps({"status": run_state["status"]}),
                }
                engine.cleanup_run(run_id)
                return

            await asyncio.sleep(1)

    return EventSourceResponse(event_generator())


@app.get("/api/test/runs")
def list_runs(limit: int = 20):
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT run_id, genie_space_id, num_users, questions_per_user,
                   think_time_min_sec, think_time_max_sec,
                   max_retries, retry_base_delay,
                   poll_interval_sec, max_poll_time_sec,
                   started_at, completed_at, status,
                   total_requests, successful_requests, failed_requests
            FROM test_runs
            ORDER BY started_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
        return [_serialize_row(r) for r in rows]


@app.get("/api/test/{run_id}/results")
def get_run_results(run_id: str):
    """Get full results with percentile calculations for a test run."""
    with get_cursor() as cur:
        cur.execute(
            "SELECT * FROM test_runs WHERE run_id = %s", (run_id,)
        )
        run = cur.fetchone()
        if not run:
            raise HTTPException(404, "Run not found")

        cur.execute(
            """
            SELECT
                request_type,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'completed') as successful,
                COUNT(*) FILTER (WHERE status != 'completed') as failed,
                ROUND(AVG(latency_ms)::numeric, 1) as avg_ms,
                ROUND(STDDEV(latency_ms)::numeric, 1) as stddev_ms,
                ROUND(PERCENTILE_CONT(0.30) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p30,
                ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p50,
                ROUND(PERCENTILE_CONT(0.60) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p60,
                ROUND(PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p80,
                ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p90,
                ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p99,
                ROUND(MIN(latency_ms)::numeric, 1) as min_ms,
                ROUND(MAX(latency_ms)::numeric, 1) as max_ms
            FROM test_requests
            WHERE run_id = %s AND latency_ms IS NOT NULL
            GROUP BY request_type
            """,
            (run_id,),
        )
        percentiles_by_type = [_serialize_row(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'completed') as successful,
                COUNT(*) FILTER (WHERE status != 'completed') as failed,
                ROUND(AVG(latency_ms)::numeric, 1) as avg_ms,
                ROUND(STDDEV(latency_ms)::numeric, 1) as stddev_ms,
                ROUND(PERCENTILE_CONT(0.30) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p30,
                ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p50,
                ROUND(PERCENTILE_CONT(0.60) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p60,
                ROUND(PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p80,
                ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p90,
                ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p99,
                ROUND(MIN(latency_ms)::numeric, 1) as min_ms,
                ROUND(MAX(latency_ms)::numeric, 1) as max_ms
            FROM test_requests
            WHERE run_id = %s AND latency_ms IS NOT NULL
            """,
            (run_id,),
        )
        overall = _serialize_row(cur.fetchone())

        cur.execute(
            """
            SELECT request_id, virtual_user_id, question, conversation_id,
                   request_type, started_at, first_response_at, completed_at,
                   latency_ms, ttfr_ms, polling_ms, status, error_message,
                   http_status_code, retry_count, backoff_time_ms, response_type
            FROM test_requests
            WHERE run_id = %s
            ORDER BY started_at
            """,
            (run_id,),
        )
        requests = [_serialize_row(r) for r in cur.fetchall()]

        # Latency breakdown (TTFR vs polling) by request type
        cur.execute(
            """
            SELECT
                request_type,
                ROUND(AVG(ttfr_ms)::numeric, 1) as avg_ttfr_ms,
                ROUND(AVG(polling_ms)::numeric, 1) as avg_polling_ms,
                ROUND(AVG(latency_ms)::numeric, 1) as avg_total_ms,
                ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ttfr_ms)::numeric, 1) as p50_ttfr_ms,
                ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ttfr_ms)::numeric, 1) as p90_ttfr_ms,
                ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY polling_ms)::numeric, 1) as p50_polling_ms,
                ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY polling_ms)::numeric, 1) as p90_polling_ms
            FROM test_requests
            WHERE run_id = %s AND ttfr_ms IS NOT NULL
            GROUP BY request_type
            """,
            (run_id,),
        )
        latency_breakdown = [_serialize_row(r) for r in cur.fetchall()]

        # Throughput metrics
        cur.execute(
            """
            SELECT
                COUNT(*) as total_requests,
                COUNT(*) FILTER (WHERE status = 'completed') as successful,
                COUNT(*) FILTER (WHERE status != 'completed') as failed,
                ROUND(EXTRACT(EPOCH FROM (MAX(completed_at) - MIN(started_at)))::numeric, 1) as duration_sec,
                ROUND((COUNT(*)::float / NULLIF(EXTRACT(EPOCH FROM (MAX(completed_at) - MIN(started_at))) / 60.0, 0))::numeric, 2) as requests_per_min,
                ROUND((COUNT(*) FILTER (WHERE status = 'completed')::float / NULLIF(EXTRACT(EPOCH FROM (MAX(completed_at) - MIN(started_at))) / 60.0, 0))::numeric, 2) as successful_per_min,
                ROUND(SUM(COALESCE(backoff_time_ms, 0))::numeric, 1) as total_backoff_ms,
                ROUND(AVG(COALESCE(backoff_time_ms, 0))::numeric, 1) as avg_backoff_ms
            FROM test_requests
            WHERE run_id = %s
            """,
            (run_id,),
        )
        throughput = _serialize_row(cur.fetchone())

        # Error analysis
        cur.execute(
            """
            SELECT
                status,
                COUNT(*) as count,
                ROUND(AVG(COALESCE(retry_count, 0))::numeric, 1) as avg_retries,
                SUM(COALESCE(retry_count, 0)) as total_retries,
                ROUND(SUM(COALESCE(backoff_time_ms, 0))::numeric, 1) as total_backoff_ms,
                ROUND(AVG(latency_ms)::numeric, 1) as avg_latency_ms
            FROM test_requests
            WHERE run_id = %s
            GROUP BY status
            ORDER BY count DESC
            """,
            (run_id,),
        )
        error_breakdown = [_serialize_row(r) for r in cur.fetchall()]

        # Per-user metrics
        cur.execute(
            """
            SELECT
                virtual_user_id,
                COUNT(*) as total_requests,
                COUNT(*) FILTER (WHERE status = 'completed') as successful,
                COUNT(*) FILTER (WHERE status != 'completed') as failed,
                ROUND(AVG(latency_ms)::numeric, 1) as avg_latency_ms,
                ROUND(MIN(latency_ms)::numeric, 1) as min_latency_ms,
                ROUND(MAX(latency_ms)::numeric, 1) as max_latency_ms,
                SUM(COALESCE(retry_count, 0)) as total_retries,
                ROUND(SUM(COALESCE(backoff_time_ms, 0))::numeric, 1) as total_backoff_ms,
                ROUND(AVG(ttfr_ms)::numeric, 1) as avg_ttfr_ms,
                ROUND(AVG(polling_ms)::numeric, 1) as avg_polling_ms
            FROM test_requests
            WHERE run_id = %s AND latency_ms IS NOT NULL
            GROUP BY virtual_user_id
            ORDER BY virtual_user_id
            """,
            (run_id,),
        )
        per_user = [_serialize_row(r) for r in cur.fetchall()]

        # Per-question metrics
        cur.execute(
            """
            SELECT
                question,
                COUNT(*) as times_asked,
                COUNT(*) FILTER (WHERE status = 'completed') as successful,
                COUNT(*) FILTER (WHERE status != 'completed') as failed,
                ROUND(AVG(latency_ms)::numeric, 1) as avg_latency_ms,
                ROUND(STDDEV(latency_ms)::numeric, 1) as stddev_ms,
                ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p50_ms,
                ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p90_ms,
                ROUND(MIN(latency_ms)::numeric, 1) as min_ms,
                ROUND(MAX(latency_ms)::numeric, 1) as max_ms,
                ROUND(AVG(ttfr_ms)::numeric, 1) as avg_ttfr_ms,
                ROUND(AVG(polling_ms)::numeric, 1) as avg_polling_ms,
                SUM(COALESCE(retry_count, 0)) as total_retries,
                MODE() WITHIN GROUP (ORDER BY response_type) as response_type
            FROM test_requests
            WHERE run_id = %s AND latency_ms IS NOT NULL
            GROUP BY question
            ORDER BY avg_latency_ms DESC
            """,
            (run_id,),
        )
        per_question = [_serialize_row(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT
                (EXTRACT(EPOCH FROM (started_at - (SELECT MIN(started_at) FROM test_requests WHERE run_id = %s))) / 10)::int * 10 as time_bucket_sec,
                COUNT(*) as requests,
                COUNT(*) FILTER (WHERE status = 'completed') as successful,
                ROUND(AVG(latency_ms)::numeric, 1) as avg_latency_ms,
                ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p50_ms,
                ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p90_ms
            FROM test_requests
            WHERE run_id = %s AND latency_ms IS NOT NULL
            GROUP BY time_bucket_sec
            ORDER BY time_bucket_sec
            """,
            (run_id, run_id),
        )
        concurrency_curve = [_serialize_row(r) for r in cur.fetchall()]

        return {
            "run": _serialize_row(run),
            "overall": overall,
            "by_type": percentiles_by_type,
            "latency_breakdown": latency_breakdown,
            "throughput": throughput,
            "error_breakdown": error_breakdown,
            "per_user": per_user,
            "per_question": per_question,
            "concurrency_curve": concurrency_curve,
            "requests": requests,
        }


@app.get("/api/test/compare")
def compare_runs(run_ids: str = Query(..., description="Comma-separated run IDs")):
    """Compare percentiles across multiple test runs."""
    ids = [r.strip() for r in run_ids.split(",") if r.strip()]
    if len(ids) < 2:
        raise HTTPException(400, "Need at least 2 run IDs to compare")

    results = []
    for run_id in ids:
        with get_cursor() as cur:
            cur.execute(
                "SELECT run_id, genie_space_id, num_users, questions_per_user, think_time_min_sec, think_time_max_sec, max_retries, retry_base_delay, poll_interval_sec, max_poll_time_sec, started_at FROM test_runs WHERE run_id = %s",
                (run_id,),
            )
            run = cur.fetchone()
            if not run:
                continue

            cur.execute(
                """
                SELECT
                    ROUND(AVG(latency_ms)::numeric, 1) as avg_ms,
                    ROUND(PERCENTILE_CONT(0.30) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p30,
                    ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p50,
                    ROUND(PERCENTILE_CONT(0.60) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p60,
                    ROUND(PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p80,
                    ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p90,
                    ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) as p99,
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'completed') as successful,
                    COUNT(*) FILTER (WHERE status != 'completed') as failed
                FROM test_requests
                WHERE run_id = %s AND latency_ms IS NOT NULL
                """,
                (run_id,),
            )
            stats = cur.fetchone()
            results.append({
                "run": _serialize_row(run),
                "stats": _serialize_row(stats),
            })

    return results


@app.delete("/api/test/{run_id}")
def delete_run(run_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM test_runs WHERE run_id = %s", (run_id,))
        conn.commit()
    return {"status": "deleted"}


# --- Question Bank ---

@app.get("/api/questions")
def list_questions(genie_space_id: str):
    with get_cursor() as cur:
        cur.execute(
            "SELECT id, genie_space_id, question, created_at FROM question_bank WHERE genie_space_id = %s ORDER BY created_at",
            (genie_space_id,),
        )
        return [_serialize_row(r) for r in cur.fetchall()]


@app.post("/api/questions")
def add_question(req: QuestionCreate):
    qid = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO question_bank (id, genie_space_id, question) VALUES (%s, %s, %s)",
            (qid, req.genie_space_id, req.question),
        )
        conn.commit()
    return {"id": qid, "status": "created"}


@app.post("/api/questions/bulk")
def add_questions_bulk(req: QuestionBulkCreate):
    ids = []
    with get_db() as conn:
        for q in req.questions:
            qid = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO question_bank (id, genie_space_id, question) VALUES (%s, %s, %s)",
                (qid, req.genie_space_id, q),
            )
            ids.append(qid)
        conn.commit()
    return {"ids": ids, "count": len(ids)}


@app.delete("/api/questions/{question_id}")
def delete_question(question_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM question_bank WHERE id = %s", (question_id,))
        conn.commit()
    return {"status": "deleted"}


# --- Serve frontend ---

import os

_static_dir = os.path.join(os.path.dirname(__file__), "static")
_assets_dir = os.path.join(_static_dir, "assets")

if os.path.isdir(_assets_dir):
    app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    index_path = os.path.join(_static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"error": "Frontend not built. Run npm run build in frontend/"}


def _serialize_row(row):
    if not row:
        return row
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d
