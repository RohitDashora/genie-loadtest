# Genie Load Tester — Standalone CLI

A single-file Python script that benchmarks [Genie API](https://docs.databricks.com/en/genie/index.html) concurrency and latency from the command line. No Lakebase, no web UI, no Databricks App deployment required.

## When to Use This

Use this standalone script instead of the [full app](../README.md) when:

- Your workspace doesn't have **Lakebase** enabled
- You don't want to deploy a **Databricks App**
- You need a quick CLI-based test you can run from any machine
- You want to integrate load testing into a CI pipeline or shell script

## Prerequisites

- Python 3.8+
- A Databricks workspace with Genie Spaces
- A valid [Databricks CLI profile](https://docs.databricks.com/en/dev-tools/cli/profiles.html) (`~/.databrickscfg`)

## Install

### With a virtual environment (recommended)

```bash
cd standalone-script
python3 -m venv venv
source venv/bin/activate    # macOS / Linux
# venv\Scripts\activate     # Windows
pip install databricks-sdk httpx
```

### Global install

```bash
pip install databricks-sdk httpx
```

That's it — two packages, no database, no Node.js.

## Questions File

Create a text file with one question per line. Blank lines and lines starting with `#` are ignored.

```text
# questions.txt — sample questions for a sales Genie Space
What were the total sales last quarter?
Show me revenue by region
How many customers churned in January?
Top 10 products by revenue
What is the average order value this year?
```

## Usage

### Basic

```bash
python genie_loadtest_cli.py \
  --space-id 01ef1234-abcd-5678-ef90-abcdef123456 \
  --questions questions.txt \
  --profile my-profile
```

### Customize concurrency

```bash
python genie_loadtest_cli.py \
  --space-id 01ef1234-abcd-5678-ef90-abcdef123456 \
  --questions questions.txt \
  --profile my-profile \
  --users 20 \
  --questions-per-user 10 \
  --think-time-min 1.0 \
  --think-time-max 5.0 \
  --output high_load_test
```

### Minimal (2 users, 2 questions each)

```bash
python genie_loadtest_cli.py \
  --space-id 01ef... \
  --questions questions.txt \
  --profile my-profile \
  --users 2 \
  --questions-per-user 2
```

### Tune retry & polling

```bash
python genie_loadtest_cli.py \
  --space-id 01ef... \
  --questions questions.txt \
  --profile my-profile \
  --max-retries 8 \
  --retry-base-delay 1.0 \
  --poll-interval 1.0 \
  --max-poll-time 600
```

### Full config

```bash
python genie_loadtest_cli.py \
  --space-id 01ef1234-abcd-5678-ef90-abcdef123456 \
  --questions questions.txt \
  --profile my-profile \
  --users 20 \
  --questions-per-user 10 \
  --think-time-min 1.0 \
  --think-time-max 5.0 \
  --max-retries 8 \
  --retry-base-delay 1.0 \
  --poll-interval 1.0 \
  --max-poll-time 600 \
  --output full_test \
  --verbose
```

### Debug mode

```bash
python genie_loadtest_cli.py \
  --space-id 01ef... \
  --questions questions.txt \
  --profile my-profile \
  --verbose
```

## CLI Reference

| Argument | Default | Description |
|----------|---------|-------------|
| `--space-id` | required | Genie Space ID (from the URL: `/genie/rooms/<space-id>`) |
| `--questions` | required | Path to questions file (one per line) |
| `--profile` | `DEFAULT` | Databricks CLI profile name from `~/.databrickscfg` |
| `--users` | `10` | Number of virtual users (1-50) |
| `--questions-per-user` | `5` | Questions each user sends (1-50) |
| `--think-time-min` | `2.0` | Minimum pause between questions (seconds) |
| `--think-time-max` | `10.0` | Maximum pause between questions (seconds) |
| `--max-retries` | `5` | Max retry attempts on HTTP 429 |
| `--retry-base-delay` | `2.0` | Exponential backoff base (seconds). Delays: 2s, 4s, 8s, 16s, 32s |
| `--poll-interval` | `2.0` | How often to check if Genie finished answering (seconds) |
| `--max-poll-time` | `300` | Max time to wait for a single answer before timeout (seconds) |
| `--output` | `results` | Output file prefix (produces `{output}_requests.csv` and `{output}_summary.csv`) |
| `--verbose` | off | Enable debug logging |

## Output Files

The script produces two CSV files:

### `{output}_requests.csv` — Raw per-request data

One row per question sent. Columns:

| Column | Description |
|--------|-------------|
| `request_id` | Unique ID for this request |
| `virtual_user_id` | Which simulated user sent it (0-based) |
| `question` | The question text |
| `conversation_id` | Genie conversation ID |
| `request_type` | `start_conversation` (first question) or `create_message` (follow-ups) |
| `started_at` | When the request was sent (UTC ISO 8601) |
| `first_response_at` | When the API acknowledged the request |
| `completed_at` | When the final answer was ready |
| `latency_ms` | Total end-to-end latency (TTFR + Polling) |
| `ttfr_ms` | Time to First Response — API acceptance time |
| `polling_ms` | Time spent polling for answer completion |
| `status` | `completed`, `error`, `timeout`, `failed`, `cancelled`, `expired` |
| `error_message` | Error details (if failed) |
| `http_status_code` | HTTP status from the Genie API |
| `retry_count` | Number of 429 retries |
| `backoff_time_ms` | Total time spent in retry backoff |
| `response_type` | Genie response classification |

### `{output}_summary.csv` — Aggregated metrics

Contains five sections:

1. **OVERALL** — avg, stddev, percentiles (P30-P99), min, max, TTFR, polling, retries
2. **BY REQUEST TYPE** — same metrics split by `start_conversation` vs `create_message`
3. **THROUGHPUT** — total requests, duration, requests/min, success rate, total backoff
4. **PER QUESTION** — per-question latency breakdown (sorted by slowest first)
5. **PER USER** — per virtual user performance

## Console Output

The script prints a live progress bar and a final summary:

```
Genie Load Test
  Space:     01ef1234-abcd-5678-ef90-abcdef123456
  Profile:   my-profile
  Config:    10 users x 5 questions = 50 requests
  Think:     2.0-10.0s
  Retry:     max 5, base delay 2.0s
  Polling:   every 2.0s, timeout 300.0s
  Questions: 8 loaded from questions.txt

[50/50] 100% ████████████████████ success=45 failed=5 avg=3.8s

============================================================
  RESULTS — COMPLETED
============================================================

  Overall:  45/50 success (90.0%)
            avg=3.8s  p50=3.2s  p90=6.1s  p99=8.4s
            stddev=1.8s  min=1.2s  max=9.1s

  Start Conv:  10 requests, avg=5.2s  p50=4.8s  p90=7.1s
            TTFR=1.1s  Polling=4.1s

  Messages:  40 requests, avg=3.5s  p50=3.1s  p90=5.6s
            TTFR=0.8s  Polling=2.7s

  Throughput: 50 requests in 2.4m (21.1 req/min)
  Retries:    8 total, 12.4s backoff

  Output:    results_requests.csv
             results_summary.csv
```

## Interpreting Results

See the [main project README](../README.md#interpreting-results) for detailed guidance on:

- What each metric measures and what to look for
- How to use per-question results for Genie instruction tuning
- Common patterns when scaling concurrency

### Quick Reference

| Metric | Healthy | Investigate |
|--------|---------|-------------|
| P50 latency | < 15s | > 30s |
| P99 / P50 ratio | < 3x | > 5x |
| Success rate | > 95% | < 80% |
| TTFR at scale | < 3s | > 10s (API throttling) |
| Retry count | < 5% of requests | > 20% of requests |

## Standalone Script vs Full App

| Capability | Standalone Script | Full App |
|------------|------------------|----------|
| **Setup** | `pip install` + one file | Lakebase + Databricks App + deploy |
| **Auth** | `--profile` flag | SDK default auth chain + OAuth to Lakebase |
| **Questions** | Text file | Web UI with question bank per Space |
| **Live monitoring** | Console progress bar | Real-time charts, latency scatter, SSE stream |
| **Results** | CSV files + console summary | Interactive web UI with 6 analysis tabs |
| **Run history** | One run at a time (files on disk) | Persistent history with compare and delete |
| **Run comparison** | Manual (compare CSVs) | Built-in side-by-side percentile comparison |
| **Dependencies** | `databricks-sdk`, `httpx` | + FastAPI, psycopg, React, Vite, Tailwind |

## Cancellation

Press `Ctrl+C` during a test to cancel gracefully. The script will:

1. Stop launching new requests
2. Wait for in-flight requests to finish
3. Output partial results to CSV
4. Print the summary with a "CANCELLED" label

Press `Ctrl+C` a second time to force-quit immediately (no output).
