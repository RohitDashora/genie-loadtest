import os
import logging

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from databricks import sdk

logger = logging.getLogger("genie-loadtest")

workspace_client = sdk.WorkspaceClient()
db_instance_name = os.getenv("DB_INSTANCE_NAME", "")


class OAuthConnection(psycopg.Connection):
    """Connection subclass that auto-refreshes OAuth credentials."""

    @classmethod
    def connect(cls, conninfo="", **kwargs):
        credential = workspace_client.database.generate_database_credential(
            instance_names=[db_instance_name]
        )
        kwargs["password"] = credential.token
        return super().connect(conninfo, **kwargs)


_pool = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        conn_string = (
            f"dbname={os.getenv('PGDATABASE', 'databricks_postgres')} "
            f"user={os.getenv('PGUSER', '')} "
            f"host={os.getenv('PGHOST', '')} "
            f"port={os.getenv('PGPORT', '5432')} "
            f"sslmode={os.getenv('PGSSLMODE', 'require')} "
            f"application_name={os.getenv('PGAPPNAME', 'genie-loadtest')}"
        )
        _pool = ConnectionPool(
            conn_string,
            connection_class=OAuthConnection,
            min_size=2,
            max_size=10,
        )
    return _pool


from contextlib import contextmanager


@contextmanager
def get_db():
    """Context manager for database connections."""
    pool = get_pool()
    with pool.connection() as conn:
        yield conn


@contextmanager
def get_cursor():
    """Context manager for database cursors with dict rows."""
    with get_db() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            yield cur


def init_db():
    """Initialize database schema (creates tables if not present)."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS test_runs (
                    run_id TEXT PRIMARY KEY,
                    genie_space_id TEXT NOT NULL,
                    num_users INT NOT NULL,
                    questions_per_user INT NOT NULL,
                    think_time_min_sec FLOAT NOT NULL,
                    think_time_max_sec FLOAT NOT NULL,
                    started_at TIMESTAMP DEFAULT NOW(),
                    completed_at TIMESTAMP,
                    status TEXT DEFAULT 'running',
                    total_requests INT DEFAULT 0,
                    successful_requests INT DEFAULT 0,
                    failed_requests INT DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS test_requests (
                    request_id TEXT PRIMARY KEY,
                    run_id TEXT REFERENCES test_runs(run_id) ON DELETE CASCADE,
                    virtual_user_id INT NOT NULL,
                    question TEXT,
                    conversation_id TEXT,
                    request_type TEXT NOT NULL,
                    started_at TIMESTAMP NOT NULL,
                    first_response_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    latency_ms FLOAT,
                    ttfr_ms FLOAT,
                    polling_ms FLOAT,
                    status TEXT DEFAULT 'pending',
                    error_message TEXT,
                    http_status_code INT,
                    retry_count INT DEFAULT 0,
                    backoff_time_ms FLOAT DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS question_bank (
                    id TEXT PRIMARY KEY,
                    genie_space_id TEXT NOT NULL,
                    question TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_test_requests_run_id ON test_requests(run_id);
                CREATE INDEX IF NOT EXISTS idx_test_requests_status ON test_requests(status);
                CREATE INDEX IF NOT EXISTS idx_question_bank_space ON question_bank(genie_space_id);

                -- Migration: add columns if they don't exist (for existing tables)
                ALTER TABLE test_requests ADD COLUMN IF NOT EXISTS ttfr_ms FLOAT;
                ALTER TABLE test_requests ADD COLUMN IF NOT EXISTS polling_ms FLOAT;
                ALTER TABLE test_requests ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;
                ALTER TABLE test_requests ADD COLUMN IF NOT EXISTS backoff_time_ms FLOAT DEFAULT 0;
            """)
        conn.commit()
    logger.info("Database schema initialized")
