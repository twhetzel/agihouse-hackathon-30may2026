#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/server"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

export PREPUBMATCH_HOST="${PREPUBMATCH_HOST:-127.0.0.1}"
export PREPUBMATCH_PORT="${PREPUBMATCH_PORT:-8000}"

echo "Starting GWAS PrePubMatch API on ${PREPUBMATCH_HOST}:${PREPUBMATCH_PORT} ..."
exec uv run uvicorn traitgraph_server.main:app \
  --host "$PREPUBMATCH_HOST" \
  --port "$PREPUBMATCH_PORT"
