#!/bin/bash
# FR-2 measurement — the same six axes on Postgres 16.15.
DB=sure_store_fr2
sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
sudo -u postgres psql -q -c "CREATE DATABASE $DB" >/dev/null 2>&1

setup() {
  sudo -u postgres psql -d "$DB" -q -v ON_ERROR_STOP=1 -c "
    DROP TABLE IF EXISTS t CASCADE; DROP TABLE IF EXISTS ty CASCADE;
    CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO t (id, name) VALUES (1, 'alpha');" >/dev/null 2>&1
}
run() {
  local label="$1"
  setup
  if out=$(sudo -u postgres psql -d "$DB" -q -v ON_ERROR_STOP=1 -c "$2" 2>&1); then
    printf "  %-42s ok  %s\n" "$label" "$(echo "$out" | tr -d '\r' | sed -n '3p' | cut -c1-52)"
  else
    printf "  %-42s FAIL: %s\n" "$label" "$(echo "$out" | grep -E 'ERROR' | head -1 | cut -c8-56)"
  fi
}
# psql has no positional-parameter CLI, so probe placeholder acceptance by
# PREPARing the statement: PREPARE succeeds only if the syntax is accepted.
runp() {
  local label="$1"
  setup
  if out=$(sudo -u postgres psql -d "$DB" -q -v ON_ERROR_STOP=1 -c "PREPARE p AS $2" 2>&1); then
    printf "  %-42s ok\n" "$label"
  else
    printf "  %-42s FAIL: %s\n" "$label" "$(echo "$out" | grep -E 'ERROR' | head -1 | cut -c8-56)"
  fi
}

echo "=== ASK 1 — params (PREPARE = accepted syntax)"
runp "WHERE id = \$1"              "SELECT id FROM t WHERE id = \$1"
runp "WHERE id = ?"                "SELECT id FROM t WHERE id = ?"
runp "WHERE id = :name"            "SELECT id FROM t WHERE id = :name"
runp "LIMIT \$1 bound"             "SELECT id FROM t LIMIT \$1"
runp "LIMIT \$1 OFFSET \$2 bound"  "SELECT id FROM t LIMIT \$1 OFFSET \$2"

echo "=== ASK 2 — clock"
run "SELECT now()"                 "SELECT now() AS v"
run "SELECT CURRENT_TIMESTAMP"     "SELECT CURRENT_TIMESTAMP AS v"
run "value shape"                  "SELECT pg_typeof(now()) AS t, now()::text AS v"
run "DEFAULT now() in DDL"         "CREATE TABLE c1 (a TIMESTAMPTZ DEFAULT now())"
run "DEFAULT CURRENT_TIMESTAMP"    "CREATE TABLE c2 (a TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)"

echo "=== ASK 3 — types"
run "DDL with TIMESTAMPTZ/BOOLEAN/JSONB" "CREATE TABLE ty (a TIMESTAMPTZ, b BOOLEAN, c JSONB)"
run "affinity / declared types"    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'ty' ORDER BY column_name"
run "JSONB round-trip keeps type"  "CREATE TABLE ty2 (c JSONB); INSERT INTO ty2 VALUES ('{\"k\":1}'); SELECT pg_typeof(c) FROM ty2"

echo "=== ASK 5 — serverInfo"
run "SELECT version()"             "SELECT version() AS v"
run "SELECT sqlite_version()"      "SELECT sqlite_version() AS v"

echo "=== ASK 6 — identifierQuote"
run 'double quote "select"'        'CREATE TABLE q1 ("select" TEXT)'
run 'backtick `select`'            'CREATE TABLE q2 (`select` TEXT)'
run 'bracket [select]'             'CREATE TABLE q3 ([select] TEXT)'

sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
