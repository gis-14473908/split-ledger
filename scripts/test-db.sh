#!/usr/bin/env bash
# Spin up a throwaway local Postgres, load a stub of Supabase's auth schema,
# apply the migrations that don't depend on Supabase Storage, and run the SQL tests.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_TEST:-55432}"
DATA="$(mktemp -d /tmp/split-ledger-pg.XXXXXX)"

as_pg() {
  if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

cleanup() {
  as_pg "$PGBIN/pg_ctl" -D "$DATA/db" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

[ "$(id -u)" = "0" ] && chown postgres "$DATA"
as_pg "$PGBIN/initdb" -D "$DATA/db" -U postgres -A trust >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$DATA/db" -o "-p $PORT -k $DATA -c listen_addresses=''" -w start >/dev/null

run() {
  # stdin, so the postgres user doesn't need read access to the checkout
  as_pg psql -X -q -v ON_ERROR_STOP=1 -h "$DATA" -p "$PORT" -U postgres -d postgres -o /dev/null < "$1"
}

run "$ROOT/supabase/tests/auth_stub.sql"
run "$ROOT/supabase/migrations/0001_schema.sql"
run "$ROOT/supabase/migrations/0002_functions.sql"
run "$ROOT/supabase/migrations/0004_hardening.sql"
run "$ROOT/supabase/migrations/0005_review_fixes.sql"
run "$ROOT/supabase/migrations/0006_opening_balance.sql"
run "$ROOT/supabase/tests/db.test.sql"
echo "db tests passed"
