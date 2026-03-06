#!/usr/bin/env bash
# scripts/seed-from-prod.sh
#
# Dumps the production RDS database and restores it into the local Docker
# PostgreSQL container. Run after `docker compose -f docker-compose.dev.yml up -d db`.
#
# WARNING: This copies production data to your local machine.
#          Do not commit, share, or expose locally restored data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/Backend/.env"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"
LOCAL_USER="athletiq"
LOCAL_DB="athletiq"

# ── Colour helpers ───────────────────────────────────────────────────────────
red()    { echo -e "\033[0;31m$*\033[0m"; }
green()  { echo -e "\033[0;32m$*\033[0m"; }
yellow() { echo -e "\033[0;33m$*\033[0m"; }

# ── 1. Dependency check ──────────────────────────────────────────────────────
if ! command -v pg_dump &>/dev/null; then
  red "ERROR: pg_dump not found."
  echo "Install with:  brew install libpq && brew link --force libpq"
  exit 1
fi

# ── 2. Read DATABASE_URL from Backend/.env ───────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  red "ERROR: $ENV_FILE not found"
  exit 1
fi

# Pick the first uncommented DATABASE_URL line
PROD_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"')

if [ -z "$PROD_URL" ]; then
  red "ERROR: DATABASE_URL not found in $ENV_FILE"
  exit 1
fi

# Mask password in displayed URL
DISPLAY_URL=$(echo "$PROD_URL" | sed 's/:\/\/[^:]*:[^@]*@/:\/\/***:***@/')
echo ""
yellow "WARNING: This will copy PRODUCTION data to your local machine."
yellow "Prod:  $DISPLAY_URL"
yellow "Local: postgresql://$LOCAL_USER@localhost:5432/$LOCAL_DB"
echo ""
read -r -p "Continue? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# ── 3. Ensure the db container is running ────────────────────────────────────
echo ""
echo "Checking db container..."
if ! docker compose -f "$COMPOSE_FILE" ps db 2>/dev/null | grep -q "running\|Up"; then
  echo "Starting db container..."
  docker compose -f "$COMPOSE_FILE" up -d db
  echo "Waiting for Postgres to be ready..."
  for i in $(seq 1 20); do
    if docker compose -f "$COMPOSE_FILE" exec -T db pg_isready -U "$LOCAL_USER" &>/dev/null; then
      break
    fi
    sleep 1
  done
fi

# ── 4. Stop backend so it releases its DB connection ────────────────────────
BACKEND_WAS_RUNNING=false
if docker compose -f "$COMPOSE_FILE" ps backend 2>/dev/null | grep -q "running\|Up"; then
  echo "Stopping backend service (releases DB connections)..."
  docker compose -f "$COMPOSE_FILE" stop backend
  BACKEND_WAS_RUNNING=true
fi

# ── 5. Drop and recreate local database ─────────────────────────────────────
echo "Resetting local '$LOCAL_DB' database..."
docker compose -f "$COMPOSE_FILE" exec -T db \
  psql -U "$LOCAL_USER" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$LOCAL_DB' AND pid <> pg_backend_pid();" \
  > /dev/null 2>&1 || true
docker compose -f "$COMPOSE_FILE" exec -T db \
  psql -U "$LOCAL_USER" -d postgres -c "DROP DATABASE IF EXISTS $LOCAL_DB;" > /dev/null
docker compose -f "$COMPOSE_FILE" exec -T db \
  psql -U "$LOCAL_USER" -d postgres -c "CREATE DATABASE $LOCAL_DB OWNER $LOCAL_USER;" > /dev/null

# ── 6. Dump prod → restore local ─────────────────────────────────────────────
echo "Dumping prod and restoring locally (may take a minute)..."
pg_dump \
  --no-owner \
  --no-acl \
  --no-tablespaces \
  --no-privileges \
  "$PROD_URL" \
| docker compose -f "$COMPOSE_FILE" exec -T db \
  psql -U "$LOCAL_USER" -d "$LOCAL_DB" -q

# ── 7. Optionally restart backend ─────────────────────────────────────────────
if [ "$BACKEND_WAS_RUNNING" = true ]; then
  echo "Restarting backend..."
  docker compose -f "$COMPOSE_FILE" start backend
fi

echo ""
green "Done. Local database seeded from prod."
