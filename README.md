# Genie Throughput Tester

A Databricks App for benchmarking [Genie API](https://docs.databricks.com/en/genie/index.html) concurrency and latency. Simulate virtual users sending questions to a Genie Space and get detailed performance metrics in real-time.

## Why Use This

When rolling out AI/BI Genie Spaces to your organization, you need to understand how they perform under load. This tool answers questions like:

- **How many concurrent users can my Genie Space handle?**
- **What's the end-to-end latency at P50, P90, P99?**
- **Which questions are slow and need instruction tuning?**
- **How does performance change as I scale from 5 to 50 users?**

## Features

- **Concurrent user simulation** — 1 to 50 virtual users, each sending multiple questions
- **Real-time monitoring** — Live latency chart and progress via Server-Sent Events
- **Detailed metrics** — Latency percentiles (P30-P99), TTFR vs polling breakdown, throughput, error analysis
- **Question bank** — Manage reusable question sets per Genie Space (single or bulk import)
- **Configurable retry strategy** — Tune max retries and exponential backoff for 429 handling
- **Run history** — Side-panel layout with persistent run list and detail view
- **Run comparison** — Select multiple runs and compare latency distributions side-by-side
- **Per-question insights** — Identify slow questions that need Genie instruction tuning

## Quick Start

### Prerequisites

- [Databricks CLI](https://docs.databricks.com/en/dev-tools/cli/install.html) v0.229.0+
- [Node.js](https://nodejs.org) 18+ and npm
- Python 3.8+
- A Databricks workspace with Genie Spaces and Lakebase enabled

### Setup (one-time)

Full instructions in [docs/setup.md](docs/setup.md). Summary:

```bash
# 1. Authenticate
databricks auth login --host https://your-workspace.cloud.databricks.com --profile my-profile

# 2. Create a Lakebase instance (stores test results)
databricks database create-database-instance genie-load-test \
    --capacity=CU_1 --enable-pg-native-login --no-wait --profile my-profile

# 3. Create the Databricks App
databricks apps create my-genie-tester --description "Genie Throughput Tester" --profile my-profile

# 4. Bind Lakebase to the app (via UI)
#    Compute > Apps > my-genie-tester > Edit > Add Resource > Database
#    Select "genie-load-test", permission: "Can connect and create"

# 5. Update app.yaml with your Lakebase instance name
#    (edit DB_INSTANCE_NAME value)
```

### Deploy

```bash
./deploy.sh <app-name> <profile>

# Example:
./deploy.sh my-genie-tester my-profile
```

The script:
1. Validates prerequisites (CLI tools, auth, app exists, no pending deploy)
2. Builds the React frontend locally
3. Stages and uploads only runtime files (10 files, ~700KB)
4. Deploys the app and waits for completion

### Redeploy after changes

```bash
./deploy.sh my-genie-tester my-profile
```

## Usage

1. **Open the app** and enter a Genie Space ID
2. **Add questions** to the question bank (single or bulk import, one per line)
3. **Configure the test:**
   - Virtual Users (1-50)
   - Questions per User (1-20)
   - Think Time (min/max seconds between questions)
   - Max Retries and Base Delay for 429 backoff
4. **Click Start Load Test** and watch results stream in
5. **Analyze results** using the tabbed detail view:
   - **Overview** — Percentiles, throughput, latency scatter plot
   - **Latency Breakdown** — Time to First Response vs Polling duration
   - **Errors & Retries** — Status distribution, retry counts, backoff time
   - **Per User** — Individual virtual user performance
   - **Per Question** — Question-level latency for instruction tuning
6. **Compare runs** — Check multiple runs in the history panel to compare side-by-side

## Architecture

See [docs/architecture.md](docs/architecture.md) for a detailed technical overview with diagrams.

```
React/Vite UI  ──REST──>  FastAPI Backend  ──REST+poll──>  Genie API
     ^                          |                          (Databricks)
     |  SSE (live updates)      |
     <──────────────────────────+
                                |
                                v
                          Lakebase (Postgres)
                          (test runs, requests, questions)
```

## Project Structure

```
genie-loadtest/
├── app.yaml                 # Databricks App runtime config
├── requirements.txt         # Python dependencies
├── deploy.sh                # Build + deploy script
├── .gitignore
├── backend/
│   ├── main.py              # FastAPI app, API routes, SSE streaming
│   ├── db.py                # Lakebase connection pool with OAuth
│   ├── genie_client.py      # Genie API client with retry logic
│   ├── test_engine.py       # Virtual user orchestration engine
│   └── static/              # Built frontend (served by FastAPI)
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main app with config panel
│   │   ├── components/      # React components (13 modules)
│   │   └── utils/api.js     # API client + SSE helper
│   ├── package.json
│   └── vite.config.js
└── docs/
    ├── setup.md             # Complete setup guide
    └── architecture.md      # Technical architecture doc
```

## Test Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Virtual Users | 1-50 | 10 | Concurrent simulated users |
| Questions/User | 1-20 | 5 | Questions each user sends |
| Think Time Min | 0-60s | 2s | Minimum pause between questions |
| Think Time Max | 0-60s | 10s | Maximum pause between questions |
| Max Retries | 0-10 | 5 | Retry attempts on 429 errors |
| Base Delay | 0.5-30s | 2s | Exponential backoff base (delays: 2s, 4s, 8s, 16s, 32s) |

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/test/start` | Start a new load test |
| POST | `/api/test/{run_id}/cancel` | Cancel a running test |
| GET | `/api/test/{run_id}/stream` | SSE stream of live progress |
| GET | `/api/test/runs` | List historical test runs |
| GET | `/api/test/{run_id}/results` | Full results with all metrics |
| GET | `/api/test/compare?run_ids=a,b` | Compare multiple runs |
| GET | `/api/questions?genie_space_id=X` | List questions for a space |
| POST | `/api/questions` | Add a single question |
| POST | `/api/questions/bulk` | Bulk add questions |
| DELETE | `/api/questions/{id}` | Delete a question |

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, Recharts, Lucide Icons
- **Backend:** FastAPI, SSE-Starlette, httpx, Pydantic
- **Database:** Lakebase (Databricks managed Postgres 16)
- **Auth:** Databricks SDK OAuth (auto-refreshing tokens)
- **Genie API:** start-conversation + create_message with polling

## Local Development

```bash
# Frontend dev server (hot reload, proxies /api to backend)
cd frontend && npm install && npm run dev

# Backend (requires Databricks auth context)
uvicorn backend.main:app --reload
```

## Stopping / Cleaning Up

```bash
# Stop the app (saves compute cost)
databricks apps stop my-genie-tester --profile my-profile

# Delete the app
databricks apps delete my-genie-tester --profile my-profile

# Stop Lakebase (preserves data)
databricks database update-database-instance genie-load-test stopped \
    --stopped=true --profile my-profile

# Delete Lakebase (PERMANENT — all data lost)
databricks database delete-database-instance genie-load-test --profile my-profile
```
