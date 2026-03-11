# Setup Guide

Deploy the Genie Throughput Tester on any Databricks workspace in 6 steps.

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| [Databricks CLI](https://docs.databricks.com/en/dev-tools/cli/install.html) | v0.229.0+ | `databricks --version` |
| [Node.js](https://nodejs.org) + npm | 18+ | `node --version` |
| Python | 3.8+ | `python3 --version` |

Your Databricks workspace must have:
- **Genie Spaces** enabled (the API you're testing)
- **Lakebase** available (managed Postgres for storing results)

## Step 1: Authenticate

```bash
databricks auth login --host https://your-workspace.cloud.databricks.com --profile my-profile
```

Verify it works:
```bash
databricks current-user me --profile my-profile
```

## Step 2: Create a Lakebase Instance

This stores all test run data (runs, requests, question bank).

```bash
databricks database create-database-instance genie-load-test \
    --capacity=CU_1 \
    --enable-pg-native-login \
    --no-wait \
    --profile my-profile
```

Wait for it to become available (~1-2 min):

```bash
databricks database get-database-instance genie-load-test --profile my-profile
# Look for: "state": "AVAILABLE"
```

> **Tip:** `CU_1` is fine for most testing. Scale up later if needed:
> | Tier | Resources | Use Case |
> |------|-----------|----------|
> | CU_1 | ~2GB RAM | Development / light testing |
> | CU_2 | ~4GB RAM | Regular testing |
> | CU_4 | ~8GB RAM | Heavy concurrent tests (20+ users) |
> | CU_8 | ~16GB RAM | Large-scale benchmarks (50 users) |

## Step 3: Create the App

```bash
databricks apps create my-genie-tester \
    --description "Genie Throughput Tester" \
    --profile my-profile
```

Wait for compute to become active (~1-2 min):
```bash
databricks apps get my-genie-tester --profile my-profile
# Look for: compute_status.state = "ACTIVE"
```

## Step 4: Bind Lakebase to the App

This gives the app access to the database and auto-populates connection environment variables (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE`, `PGAPPNAME`).

**Via UI (recommended):**
1. Open your workspace > **Compute** > **Apps** > **my-genie-tester**
2. Click **Edit**
3. Click **Add Resource** > **Database**
4. Select instance **genie-load-test**
5. Set permission to **Can connect and create**
6. Click **Save**

**Via CLI:**
```bash
databricks apps update my-genie-tester \
    --json '{
        "resources": [{
            "name": "genie-load-test-db",
            "database": {
                "instance_name": "genie-load-test",
                "database_name": "databricks_postgres",
                "permission": "CAN_CONNECT_AND_CREATE"
            }
        }]
    }' \
    --profile my-profile
```

## Step 5: Update app.yaml

Edit `app.yaml` in the project root and set `DB_INSTANCE_NAME` to match your Lakebase instance name:

```yaml
command: ["uvicorn", "backend.main:app"]
env:
  - name: DB_INSTANCE_NAME
    value: "genie-load-test"    # <-- must match your instance name from Step 2
```

## Step 6: Deploy

```bash
./deploy.sh my-genie-tester my-profile
```

The script will:
1. Validate prerequisites (CLI tools, auth, app exists, no pending deploy)
2. Build the React frontend locally (`npm install && npm run build`)
3. Stage and upload only runtime files (~10 files, ~700KB)
4. Deploy the app and wait for it to start

On success, it prints the app URL. Open it to start testing.

## Redeploying

After any code changes, just re-run:

```bash
./deploy.sh my-genie-tester my-profile
```

## Stopping / Cleaning Up

```bash
# Stop the app (saves compute cost, preserves data)
databricks apps stop my-genie-tester --profile my-profile

# Resume later
databricks apps start my-genie-tester --profile my-profile

# Delete the app entirely
databricks apps delete my-genie-tester --profile my-profile

# Pause Lakebase (preserves data, stops billing)
databricks database update-database-instance genie-load-test stopped \
    --stopped=true --profile my-profile

# Resume Lakebase
databricks database update-database-instance genie-load-test stopped \
    --stopped=false --profile my-profile

# Delete Lakebase (PERMANENT — all test data lost)
databricks database delete-database-instance genie-load-test --profile my-profile
```

## Troubleshooting

### "App is UNAVAILABLE"
The app compute auto-stops after inactivity. Start it:
```bash
databricks apps start my-genie-tester --profile my-profile
```

### "Instance not available or is paused"
Resume the Lakebase instance:
```bash
databricks database update-database-instance genie-load-test stopped \
    --stopped=false --profile my-profile
```

### Database connection errors
Verify the Lakebase resource is bound to the app (Step 4). The app needs these environment variables:
- `PGHOST` — Lakebase instance hostname (auto-set by resource binding)
- `PGUSER` — App's service principal client ID (auto-set)
- `DB_INSTANCE_NAME` — Must match your Lakebase instance name exactly (set in `app.yaml`)

### "permission denied for schema public"
This happens when the app's service principal doesn't have permissions on existing tables (e.g., tables created by a different app or user). Connect to Lakebase with your user account and grant access:
```sql
GRANT USAGE, CREATE ON SCHEMA public TO "<app-service-principal-id>";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "<app-service-principal-id>";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "<app-service-principal-id>";
```
Find the service principal ID in the app details (`service_principal_client_id` field).

### Deploy stuck on "Preparing source code"
The platform has a 20-minute lockout on pending deployments. Wait for it to expire, then retry. If it persists, delete and recreate the app.

### "A deployment is already in progress"
The deploy script detects this automatically. Wait for the current deployment to finish:
```bash
databricks apps get my-genie-tester --profile my-profile
```

### "must be owner of table test_requests"
This happens when the tables were created by a different service principal (e.g., you recreated the app or bound a different Lakebase instance). The app needs table ownership to run schema migrations. Transfer ownership:
```sql
ALTER TABLE test_runs OWNER TO "<service-principal-id>";
ALTER TABLE test_requests OWNER TO "<service-principal-id>";
ALTER TABLE question_bank OWNER TO "<service-principal-id>";
```
Find the service principal ID:
```bash
databricks apps get my-genie-tester --profile my-profile
# Look for: service_principal_client_id
```
