#!/bin/sh
set -e

# DATABASE_URL looks like `sqlite:/data/relay.db`; dbmate and the app share it.
DB_PATH="${DATABASE_URL#sqlite:}"
mkdir -p "$(dirname "$DB_PATH")"

echo "[claude-relay] running migrations..."
dbmate --no-dump-schema up

echo "[claude-relay] starting server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec node server.js
