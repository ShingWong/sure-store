#!/bin/bash
# FR-1 measurement — the same capability matrix on Postgres 16.15.
# Fresh connection per capability; nothing assumed.
DB=sure_store_fr1
sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
sudo -u postgres psql -q -c "CREATE DATABASE $DB" >/dev/null 2>&1

setup() {
  sudo -u postgres psql -d "$DB" -q -v ON_ERROR_STOP=1 -c "
    DROP TABLE IF EXISTS t CASCADE;
    CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO t (id, name) VALUES (1, 'alpha');" >/dev/null 2>&1
}

run() {
  local label="$1"; shift
  setup
  if out=$(sudo -u postgres psql -d "$DB" -q -v ON_ERROR_STOP=1 -c "$1" 2>&1); then
    printf "  %-32s ok\n" "$label"
  else
    printf "  %-32s FAIL: %s\n" "$label" "$(echo "$out" | grep -E 'ERROR' | head -1 | cut -c8-56)"
  fi
}

echo "=== Postgres 16.15"
run "tx.start BEGIN"            "BEGIN"
run "tx.start BEGIN IMMEDIATE"  "BEGIN IMMEDIATE"
run "tx.commit COMMIT"          "BEGIN; COMMIT;"
run "tx.abort ROLLBACK"         "BEGIN; ROLLBACK;"
run "savepoint"                 "BEGIN; SAVEPOINT sp; RELEASE sp; COMMIT;"
run "isolation SET TRANSACTION" "BEGIN; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; COMMIT;"
run "forUpdate SELECT..FOR UPDATE" "SELECT id FROM t WHERE id = 1 FOR UPDATE"
run "advisoryLock pg_advisory_lock" "SELECT pg_advisory_lock(1)"
run "returning after INSERT"    "INSERT INTO t (id, name) VALUES (2,'b') RETURNING id, name"
run "onConflict DO UPDATE"      "INSERT INTO t (id,name) VALUES (1,'a2') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name"
run "onConflict DO NOTHING"     "INSERT INTO t (id,name) VALUES (1,'x') ON CONFLICT (id) DO NOTHING"
run "partial unique index"      "CREATE UNIQUE INDEX t_name_u ON t (name) WHERE name IS NOT NULL"
run "expression index"          "CREATE INDEX t_low ON t (lower(name))"
run "advisory xact lock"        "BEGIN; SELECT pg_advisory_xact_lock(1); COMMIT;"

sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
