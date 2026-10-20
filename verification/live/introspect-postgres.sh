#!/usr/bin/env bash
# Live probe — postgres introspection: what the catalog will actually tell us.
#
# Task 2.2, the expensive half. Same schema as introspect-sqlite.mjs so the two
# result shapes can be compared row for row rather than described from memory.
#
#   bash verification/live/introspect-postgres.sh
#
# Prints raw information_schema rows as JSON. No normalization here.
set -euo pipefail

DB=sure_store_probe
PSQL="sudo -u postgres psql"

$PSQL -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true
sudo -u postgres createdb "$DB"

$PSQL -q -d "$DB" <<'SQL'
CREATE TABLE parent (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE child (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  label VARCHAR(40) DEFAULT 'x',
  note TEXT
);
SQL

section () {
  printf '\n-- %s\n' "$1"
  $PSQL -d "$DB" -tA -c "$2"
}

section "server" "SELECT json_build_object('engine','postgres','version',version())"

section "tables" "
SELECT json_agg(t) FROM (
  SELECT table_schema, table_name, table_type
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
) t"

section "columns" "
SELECT json_agg(t) FROM (
  SELECT table_name, ordinal_position, column_name, data_type, udt_name,
         is_nullable, column_default, character_maximum_length,
         numeric_precision, numeric_scale, datetime_precision
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
) t"

section "primaryKeys" "
SELECT json_agg(t) FROM (
  SELECT tc.table_name, tc.constraint_name, kcu.column_name, kcu.ordinal_position
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name
   AND kcu.table_schema = tc.table_schema
  WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
  ORDER BY tc.table_name, kcu.ordinal_position
) t"

section "foreignKeys" "
SELECT json_agg(t) FROM (
  SELECT tc.table_name, tc.constraint_name, kcu.column_name, kcu.ordinal_position,
         ccu.table_name AS foreign_table, ccu.column_name AS foreign_column,
         rc.delete_rule, rc.update_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name
   AND kcu.table_schema = tc.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
   AND ccu.table_schema = tc.table_schema
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name
   AND rc.constraint_schema = tc.table_schema
  WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
  ORDER BY tc.table_name, kcu.ordinal_position
) t"

$PSQL -q -c "DROP DATABASE $DB" >/dev/null
