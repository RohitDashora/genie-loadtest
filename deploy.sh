#!/usr/bin/env bash
set -euo pipefail

# Genie Load Tester — build & deploy
# Usage: ./deploy.sh <app-name> <profile>
#
# Examples:
#   ./deploy.sh my-genie-load-test my-profile
#   ./deploy.sh genie-throughput fe-vm-v2
#
# Prerequisites (one-time):
#   1. Create the app:     databricks apps create <app-name> -p <profile>
#   2. Bind Lakebase:      Compute > Apps > <app-name> > Edit > Add Resource > Database
#   3. Full instructions:  docs/setup.md

if [ $# -lt 2 ]; then
    echo "Usage: ./deploy.sh <app-name> <profile>"
    echo ""
    echo "  app-name   Name of the Databricks App (must already exist)"
    echo "  profile    Databricks CLI profile"
    echo ""
    echo "Setup: see docs/setup.md"
    exit 1
fi

APP_NAME="$1"
PROFILE="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Preflight checks ---

echo "==> Checking prerequisites..."

# Verify CLI tools are available
for cmd in databricks npm python3; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: '$cmd' not found."
        exit 1
    fi
done

# Verify profile authenticates
USER_EMAIL=$(databricks current-user me -p "$PROFILE" -o json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['userName'])" 2>/dev/null) || {
    echo "ERROR: Could not authenticate with profile '$PROFILE'."
    echo "Run: databricks auth login --host <workspace-url> --profile $PROFILE"
    exit 1
}

# Verify app exists and is not mid-deploy
APP_JSON=$(databricks apps get "$APP_NAME" -p "$PROFILE" -o json 2>/dev/null) || {
    echo "ERROR: App '$APP_NAME' not found."
    echo "Create it: databricks apps create $APP_NAME -p $PROFILE"
    exit 1
}

PENDING=$(echo "$APP_JSON" | python3 -c "
import sys,json; d=json.load(sys.stdin)
pd=d.get('pending_deployment') or {}
print(pd.get('status',{}).get('state',''))" 2>/dev/null)

if [ "$PENDING" = "IN_PROGRESS" ]; then
    echo "ERROR: A deployment is already in progress. Wait for it to finish."
    echo "Check: databricks apps get $APP_NAME -p $PROFILE"
    exit 1
fi

WORKSPACE_PATH="/Workspace/Users/$USER_EMAIL/apps/$APP_NAME"
echo "    App:     $APP_NAME"
echo "    Profile: $PROFILE"
echo "    Target:  $WORKSPACE_PATH"
echo ""

# --- Step 1: Build frontend ---

echo "==> Building frontend..."
cd "$SCRIPT_DIR/frontend"
npm install --silent 2>&1 | tail -1
rm -rf node_modules/.vite ../backend/static
npm run build 2>&1
cd "$SCRIPT_DIR"
echo ""

# --- Step 2: Stage runtime files ---
# We stage into a temp dir so we upload exactly what the app needs:
#   app.yaml, requirements.txt, backend/ (including built static assets)
# This avoids uploading frontend source, node_modules, docs, etc.

echo "==> Uploading to workspace..."
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

cp app.yaml requirements.txt "$STAGING/"
cp -r backend "$STAGING/"

FILE_COUNT=$(find "$STAGING" -type f | wc -l | tr -d ' ')
echo "    Staging $FILE_COUNT files..."

databricks workspace import-dir "$STAGING" "$WORKSPACE_PATH" \
    --overwrite \
    -p "$PROFILE"
echo "    Uploaded."
echo ""

# --- Step 3: Deploy ---

echo "==> Deploying app (this takes a few minutes)..."
databricks apps deploy "$APP_NAME" \
    --source-code-path "$WORKSPACE_PATH" \
    -p "$PROFILE"

# Print app URL
URL=$(databricks apps get "$APP_NAME" -p "$PROFILE" -o json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || true)

echo ""
echo "============================================"
echo "  Deployed: ${URL:-<check app in workspace>}"
echo "============================================"
