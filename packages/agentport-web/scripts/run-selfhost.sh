#!/usr/bin/env bash
set -euo pipefail

web_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
self_host="$(cd "$web_dir/../happy-server-self-host" && pwd)"

if [[ ! -f "$web_dir/dist/index.html" || ! -f "$self_host/dist/standalone.mjs" ]]; then
  echo "Build agentport-web and happy-server-self-host before starting the server." >&2
  exit 1
fi

: "${DATA_DIR:?Set DATA_DIR to an absolute path for the local Self-host instance}"
: "${HANDY_MASTER_SECRET:?Set a dedicated HANDY_MASTER_SECRET for this instance}"

export DATA_DIR HANDY_MASTER_SECRET
export HOST=127.0.0.1 PORT="${PORT:-3005}" DB_PROVIDER=pglite
export PGLITE_DIR="${PGLITE_DIR:-$DATA_DIR/pglite}" HAPPY_STATIC_DIR="$web_dir/dist"

cd "$self_host"
node dist/standalone.mjs migrate
exec node dist/standalone.mjs serve
