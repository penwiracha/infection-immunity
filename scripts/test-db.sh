#!/usr/bin/env bash
# Run the database test suite against a throwaway local Postgres database.
#   PGHOST/PGPORT/PGUSER as usual (needs a superuser and the pgtap + pg_trgm extensions).
# On a Supabase project use `supabase test db` instead — it runs supabase/tests/database/*.sql.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-ii_test}"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -q -v ON_ERROR_STOP=1 -d $DB"
$P -f scripts/local-supabase-shim.sql
for f in supabase/migrations/*.sql; do $P -f "$f"; done
$P -f supabase/seed.sql
status=0
for t in supabase/tests/database/*.sql; do
  echo "== $t"
  out=$(psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -f "$t" 2>&1) || status=1
  echo "$out"
  echo "$out" | grep -qE '^not ok|Looks like you|ERROR' && status=1
done
[ $status -eq 0 ] && echo "ALL DATABASE TESTS PASSED" || echo "DATABASE TESTS FAILED"
exit $status
