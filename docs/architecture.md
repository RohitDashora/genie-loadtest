# Architecture

## Overview

Genie Load Tester is a full-stack Databricks App that stress-tests Genie Spaces by simulating concurrent virtual users. It measures end-to-end latency, time to first response (TTFR), polling duration, retry behavior, and throughput — providing the data needed to tune Genie Space instructions and understand API capacity limits.

**Diagrams in this doc:** [System & external deps](#system-diagram) · [Components](#components) · [Database ER](#database-lakebase) · [Test execution sequence](#test-execution-flow) · [SSE monitoring sequence](#real-time-monitoring-flow) · [Deployment](#deployment)

## System Diagram

```mermaid
flowchart TB
    subgraph App["Databricks App"]
        subgraph Frontend["React Frontend (Vite + Tailwind)"]
            Config["Config Panel"]
            Monitor["Live Monitor"]
            History["Run History"]
            Charts["Charts / Tables"]
        end

        subgraph Backend["FastAPI Backend"]
            API["main.py — API Routes"]
            subgraph Engine["Test Engine (asyncio)"]
                VU0["VUser 0"]
                VU1["VUser 1"]
                VUN["VUser N"]
            end
            GenieClient["Genie Client (httpx + retry)"]
        end
    end

    Lakebase["Lakebase (Postgres 16)"]
    GenieAPI["Genie API (Databricks)"]

    Frontend -->|"HTTP / REST"| API
    API -->|"SSE stream"| Frontend
    API --> Engine
    Engine --> GenieClient
    GenieClient -->|"start-conversation\ncreate_message\npoll message"| GenieAPI
    API -->|"OAuth + SQL"| Lakebase
    Engine -->|"persist requests"| Lakebase
```

### External Dependencies

```mermaid
flowchart LR
    subgraph App["Genie Load Tester App"]
        FE[React UI]
        BE[FastAPI]
    end
    BE -->|OAuth + queries| LB[Lakebase Postgres]
    BE -->|REST + poll| Genie[Genie API]
    FE -->|SSE| BE
    FE -->|REST| BE
```

## Components

### Frontend (React)

Single-page app built with Vite, Tailwind CSS, and Recharts. Served as static files by FastAPI.

![App overview — metrics, throughput, and concurrency curve](images/overview.png)

| Component | Purpose |
|-----------|---------|
| `App.jsx` | Main layout, test configuration panel, tab navigation |
| `LiveMonitor.jsx` | Real-time test progress via SSE, live latency chart |
| `RunHistory.jsx` | Side-panel layout: scrollable run list + detail/compare view |
| `QuestionBank.jsx` | CRUD for questions per Genie Space |
| `MetricCard.jsx` | Reusable metric display with dual ms/seconds format |
| `PercentileChart.jsx` | Bar chart of latency percentiles (P30-P99) |
| `LatencyScatter.jsx` | Scatter plot of latency over time (success vs failed) |
| `LatencyBreakdown.jsx` | Stacked bar: TTFR vs Polling by request type |
| `ThroughputPanel.jsx` | Duration, RPM, success rate, total backoff |
| `ErrorAnalysis.jsx` | Pie chart + table of status distribution |
| `PerUserTable.jsx` | Per virtual user performance breakdown |
| `PerQuestionTable.jsx` | Per question latency (for instruction tuning) |
| `CompareChart.jsx` | Config comparison table + side-by-side percentile chart |
| `ConcurrencyCurve.jsx` | Area chart of Avg/P50/P90 latency over 10-second time buckets |
| `HelpTip.jsx` | Reusable hover tooltip for config field explanations |

### Backend (FastAPI)

#### `main.py` — API Routes

- **Test lifecycle:** Start, cancel, delete, stream progress (SSE), list runs, get results, compare runs
- **Question bank:** CRUD operations for managing test questions per Genie Space
- **Run deletion:** `DELETE /api/test/{run_id}` with cascading cleanup of test_requests
- **Static serving:** Serves the built React app, with SPA fallback routing

#### `test_engine.py` — Virtual User Orchestration

The test engine manages concurrent virtual users using Python's `asyncio`:

1. Loads questions from the question bank for the given Genie Space
2. Creates N async tasks (one per virtual user), staggered by 0.5-2s to avoid thundering herd
3. Each virtual user:
   - Calls `start_conversation` with the first question (establishes a Genie conversation)
   - Sends remaining questions via `create_message` within that conversation
   - Waits a random "think time" between questions
   - Records timing metrics for every request
4. Results are accumulated in memory and written to Lakebase per-request
5. Status is exposed to the SSE stream for real-time frontend updates

#### `genie_client.py` — Genie API Client

Handles communication with the Databricks Genie API:

- **Authentication:** Uses `databricks-sdk` WorkspaceClient for OAuth token management
- **Endpoints called:**
  - `POST /api/2.0/genie/spaces/{id}/start-conversation` — Start a new conversation
  - `POST /api/2.0/genie/spaces/{id}/conversations/{cid}/messages` — Send follow-up message
  - `GET /api/2.0/genie/spaces/{id}/conversations/{cid}/messages/{mid}` — Poll for completion
- **Retry strategy:** Configurable exponential backoff on HTTP 429 (rate limited)
  - Formula: `base_delay * (2 ^ attempt)` (ignores server Retry-After header)
  - Default: 2s, 4s, 8s, 16s, 32s
- **Polling:** Configurable poll interval (default 2s) and timeout (default 300s), both tunable per-run via the UI
- **Metrics tracked:** start_time, first_response_time, completed_time, retry_count, backoff_time_ms, response_type (Genie API status pass-through)

#### `db.py` — Database Layer

- **Connection:** psycopg v3 with ConnectionPool
- **Auth:** Custom `OAuthConnection` subclass that calls `database.generate_database_credential()` on each new connection, providing fresh OAuth tokens
- **Schema:** Auto-initializes tables on startup with `CREATE TABLE IF NOT EXISTS` and migration `ALTER TABLE ADD COLUMN IF NOT EXISTS`

### Database (Lakebase)

Provisioned Postgres 16 instance managed by Databricks. Three tables:

```mermaid
erDiagram
    test_runs ||--o{ test_requests : "run_id"

    test_runs {
        text run_id PK
        text genie_space_id
        int num_users
        int questions_per_user
        float think_time_min_sec
        float think_time_max_sec
        int max_retries
        float retry_base_delay
        float poll_interval_sec
        float max_poll_time_sec
        timestamp started_at
        timestamp completed_at
        text status
        int total_requests
        int successful_requests
        int failed_requests
    }

    test_requests {
        text request_id PK
        text run_id FK
        int virtual_user_id
        text question
        text conversation_id
        text request_type
        timestamp started_at
        timestamp first_response_at
        timestamp completed_at
        float latency_ms
        float ttfr_ms
        float polling_ms
        text status
        text error_message
        int http_status_code
        int retry_count
        float backoff_time_ms
        text response_type
    }

    question_bank {
        text id PK
        text genie_space_id
        text question
        timestamp created_at
    }
```

#### `test_runs`
| Column | Type | Description |
|--------|------|-------------|
| run_id | TEXT PK | UUID for the test run |
| genie_space_id | TEXT | Target Genie Space |
| num_users | INT | Number of virtual users |
| questions_per_user | INT | Questions per user |
| think_time_min_sec | FLOAT | Min think time |
| think_time_max_sec | FLOAT | Max think time |
| max_retries | INT | Max retry attempts on 429 |
| retry_base_delay | FLOAT | Exponential backoff base (seconds) |
| poll_interval_sec | FLOAT | Polling frequency (seconds) |
| max_poll_time_sec | FLOAT | Max wait time per question (seconds) |
| started_at | TIMESTAMP | Run start time |
| completed_at | TIMESTAMP | Run completion time |
| status | TEXT | running / completed / failed / cancelled |
| total_requests | INT | Total requests made |
| successful_requests | INT | Successful completions |
| failed_requests | INT | Failed requests |

#### `test_requests`
| Column | Type | Description |
|--------|------|-------------|
| request_id | TEXT PK | UUID per request |
| run_id | TEXT FK | Parent test run |
| virtual_user_id | INT | Which virtual user |
| question | TEXT | The question asked |
| conversation_id | TEXT | Genie conversation ID |
| request_type | TEXT | start_conversation or create_message |
| started_at | TIMESTAMP | Request start |
| first_response_at | TIMESTAMP | First API response received |
| completed_at | TIMESTAMP | Final completion |
| latency_ms | FLOAT | Total end-to-end latency |
| ttfr_ms | FLOAT | Time to first response |
| polling_ms | FLOAT | Time spent polling for completion |
| status | TEXT | completed / error / timeout / failed |
| error_message | TEXT | Error details if failed |
| http_status_code | INT | HTTP status from Genie API |
| retry_count | INT | Number of 429 retries |
| backoff_time_ms | FLOAT | Total time spent in backoff |
| response_type | TEXT | Genie response classification: sql / clarification / refusal / error / unknown |

#### `question_bank`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| genie_space_id | TEXT | Associated Genie Space |
| question | TEXT | The question text |
| created_at | TIMESTAMP | When added |

## Data Flow

### Test Execution Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API as main.py
    participant DB as Lakebase
    participant Engine as TestEngine
    participant Genie as Genie API

    User->>Frontend: Start Load Test
    Frontend->>API: POST /api/test/start
    API->>DB: INSERT test_runs (status=running)
    API->>Engine: asyncio.create_task(start_test)
    API-->>Frontend: { run_id }

    par Virtual users (staggered)
        Engine->>DB: Load question_bank
        loop Each virtual user
            Engine->>Genie: POST start-conversation (retry on 429)
            Genie-->>Engine: conversation_id, message_id
            Engine->>Genie: GET message (poll until done)
            Genie-->>Engine: terminal state
            Engine->>DB: INSERT test_requests
            loop Remaining questions
                Engine->>Engine: sleep(think_time)
                Engine->>Genie: POST create_message (retry on 429)
                Engine->>Genie: GET message (poll)
                Engine->>DB: INSERT test_requests
            end
        end
    end
    Engine->>DB: UPDATE test_runs (status=completed, counts)
```

### Real-Time Monitoring Flow

```mermaid
sequenceDiagram
    participant Frontend
    participant API as main.py
    participant Engine as TestEngine
    participant DB as Lakebase

    Frontend->>API: GET /api/test/{run_id}/stream (EventSource)
    loop Every ~1 second
        API->>Engine: get_run_status(run_id)
        Engine-->>API: status, completed, new_results
        API-->>Frontend: SSE event: progress
    end
    Note over API,Engine: Test completes
    API-->>Frontend: SSE event: done
    Note over API,Engine: Run evicted from memory
    Frontend->>API: GET /api/test/{run_id}/results
    API->>DB: Aggregate queries (percentiles, breakdown, errors, per-user, per-question)
    DB-->>API: Result sets
    API-->>Frontend: Full results JSON
```

### SSE Event Protocol

The `/api/test/{run_id}/stream` endpoint uses [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events). The frontend connects via `EventSource` and listens for three named event types:

#### `progress` event (emitted ~1/second while the test is running)

```json
{
  "status": "running",
  "total": 50,
  "completed": 23,
  "successful": 21,
  "failed": 2,
  "new_results": [
    {
      "request_id": "uuid",
      "user_id": 3,
      "question": "What is total revenue by region?",
      "request_type": "create_message",
      "latency_ms": 8432.1,
      "status": "completed",
      "timestamp": "2025-01-15T10:23:45.123Z"
    }
  ]
}
```

`new_results` contains only the requests completed since the last event (delta, not cumulative). The frontend appends these to its live latency chart.

#### `done` event (emitted once when the test reaches a terminal state)

```json
{ "status": "completed" }
```

Status is one of `completed`, `failed`, or `cancelled`. After receiving this event, the frontend closes the `EventSource` and fetches full aggregated results via `GET /api/test/{run_id}/results`.

#### `error` event (emitted if the run ID is not found)

```json
{ "error": "Run not found" }
```

This can occur if the SSE connection is opened after the run has already been evicted from in-memory tracking and the DB lookup confirms it's in a terminal state (in which case a `done` event is sent instead).

## Deployment

### Topology

```mermaid
flowchart LR
    subgraph WS["Databricks Workspace"]
        APP["Databricks App\n(FastAPI + React)"]
        LB["Lakebase\n(Postgres 16)"]
    end
    LOCAL["Local Machine\n(deploy.sh)"] -->|"build + upload\n+ deploy"| APP
    APP -->|"resource binding\nCAN_CONNECT_AND_CREATE"| LB
    APP -->|"OAuth + Genie API"| GENIE["Genie API"]
```

### How deploy.sh Works

The app is deployed via a shell script (`deploy.sh`) that handles the build-upload-deploy pipeline:

1. **Preflight checks** — Validates CLI tools, auth profile, app exists, no pending deploy
2. **Build frontend** — Runs `npm install && npm run build` in `frontend/`, outputs to `backend/static/`
3. **Stage runtime files** — Copies only what the app needs to a temp directory:
   - `app.yaml`, `requirements.txt`, `backend/` (including built static assets)
   - This avoids uploading frontend source, `node_modules`, docs, etc.
4. **Upload** — `databricks workspace import-dir` pushes the staged files (~10 files, ~700KB)
5. **Deploy** — `databricks apps deploy` triggers the Databricks platform to install dependencies and start the app

The Lakebase database is provisioned separately and bound to the app as a resource, which auto-populates all PG connection environment variables (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE`, `PGAPPNAME`) in the app runtime.

## How Metrics Are Calculated

### Timing Breakdown

Each request records three timestamps: `started_at`, `first_response_at`, and `completed_at`. Metrics are derived as follows:

```mermaid
sequenceDiagram
    participant App as Virtual User
    participant API as Genie API

    Note over App: started_at
    App->>API: POST start-conversation / create_message
    Note over App,API: TTFR (ms)
    API-->>App: conversation_id / message_id
    Note over App: first_response_at
    loop Poll every poll_interval
        App->>API: GET message status
        API-->>App: status
    end
    Note over App,API: Polling (ms)
    Note over App: completed_at
    Note over App,API: Latency (ms) = TTFR + Polling
```

- **TTFR** = `first_response_at - started_at` — time for the Genie API to accept the request and return a conversation/message ID.
- **Polling** = `completed_at - first_response_at` — time spent polling the message endpoint until it reaches a terminal state (`COMPLETED`, `FAILED`, `CANCELLED`, `EXPIRED`).
- **Latency** = `completed_at - started_at` = TTFR + Polling. This is the total end-to-end time the virtual user waited.
- **Backoff time** is tracked separately and is **not** included in latency. A request with 10s of 429 backoff and 5s of actual work shows `latency_ms = 5000`, `backoff_time_ms = 10000`.

### Percentile Calculations

Percentiles are computed server-side via Postgres `PERCENTILE_CONT()`:

```sql
PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)
```

- **Scope:** All requests with non-null `latency_ms` for the given run — this includes both successful and failed requests. Failed requests that consumed real time represent genuine load on the system.
- **Exclusions:** Only requests where `latency_ms IS NULL` are excluded (e.g., skipped requests when `start_conversation` failed and remaining questions were abandoned with `latency_ms = 0`, which is included).
- **Breakdown by type:** Percentiles are also computed separately for `start_conversation` and `create_message` request types, since `start_conversation` typically has higher latency (cold-starts a new Genie session).

### Throughput

- **Requests per minute** = `total_requests / (duration_sec / 60)`
- **Duration** = `MAX(completed_at) - MIN(started_at)` across all requests in the run
- **Success rate** = `successful / total_requests`

## Key Design Decisions

1. **Exponential backoff (not server Retry-After):** Genie returns `Retry-After: 60` which is too conservative for load testing. We use our own `base_delay * 2^attempt` so backoff is configurable per run and allows faster recovery.

2. **Conversation reuse:** Each virtual user starts one conversation, then sends follow-up messages within it. This tests the realistic pattern of Genie usage rather than creating a new conversation per question.

3. **Staggered user starts:** Virtual users are launched with 0.5-2s jitter to avoid a thundering herd on the first request wave.

4. **In-memory + DB recording:** Test progress is tracked in-memory (for fast SSE streaming) and simultaneously written to Lakebase per-request (for durable analytics). Completed runs are evicted from memory after the SSE stream ends, with a 5-minute TTL safety net for abandoned connections (e.g., browser tab closed mid-test). Final aggregations use SQL percentile functions.

5. **OAuth token refresh per connection:** The psycopg `OAuthConnection` subclass generates a fresh token for each new pool connection, handling the 1-hour token expiry automatically.

6. **Per-question metrics:** Surfaces which specific questions are slow, enabling targeted Genie instruction tuning rather than blind optimization.

7. **Configurable polling per-run:** Poll interval and timeout are stored with each test run, allowing users to tune responsiveness vs API load. Lower poll intervals detect completion faster but generate more GET requests. All config is persisted to Lakebase so historical runs retain their full configuration for comparison.

8. **Status pass-through:** The Genie API completion status (`completed`, `failed`, `cancelled`, `expired`) is recorded per-request as-is, without interpretation. This is a latency tester, not a correctness checker — the status is tracked for filtering and diagnostics, not for classifying response quality.
