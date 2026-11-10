#!/usr/bin/env bash
# release_queue() against a throwaway local Postgres: the schema stub, then the
# real Job Queue migrations, then the nights test. Touches no Supabase project.
# Usage: bash tests/pipeline/release-queue-pg.sh   (needs PostgreSQL binaries; PG_BIN overrides)
set -euo pipefail
cd "$(dirname "$0")/../.."
PG_BIN="${PG_BIN:-/c/Program Files/PostgreSQL/17/bin}"
DIR="$(mktemp -d)"; PORT="${PG_TEST_PORT:-55439}"
trap '"$PG_BIN/pg_ctl" -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"$PG_BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT" -l "$DIR/log" -w start >/dev/null
psql() { "$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT" -U postgres -d postgres "$@"; }
psql -f tests/pipeline/release-queue-schema-stub.sql
for m in 20261127_queue_release 20261130_queue_release_indexes 20261202_queue_release_nights; do
  psql -f "supabase/migrations/$m.sql" >/dev/null
done
psql -f tests/pipeline/release-queue.pgtest.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
