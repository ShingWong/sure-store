// Live probe: can the introspection record be the DDL source?
//
// The tempting shortcut for Q4 (a shared schema DSL) is "the record shape is
// already neutral and fixture-pinned; render DDL from it". This measures what
// that would cost: two tables whose records are identical but whose DDL is not.
//
//   node --experimental-strip-types verification/live/ddl-from-records.mjs

import { DatabaseSync } from "node:sqlite";

import {
  getEngine,
  loadContracts,
  normalizeColumns,
  normalizeForeignKeys,
  normalizePrimaryKeys,
  renderIntrospection,
} from "../../impl/ts/index.ts";

const engines = loadContracts();
const engine = getEngine(engines, "sqlite");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE plain (id INTEGER PRIMARY KEY, email TEXT NOT NULL, price NUMERIC DEFAULT 0);
  CREATE TABLE rich (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    price NUMERIC DEFAULT 0 CHECK (price >= 0)
  );
  CREATE INDEX rich_lower_email ON rich (lower(email));
`);

function rows(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function records(table) {
  const q = (section) => renderIntrospection(engine, section, { table });
  const columns = normalizeColumns(engine, rows(q("columns").sql));
  return {
    tables: rows(q("tables").sql).filter((r) => r.table_name === table),
    columns,
    // sqlite derives the PK from the columns result: there is no statement.
    primaryKeys: normalizePrimaryKeys(engine, [], columns),
    foreignKeys: normalizeForeignKeys(engine, rows(q("foreignKeys").sql), table),
  };
}

const strip = (r) => JSON.parse(JSON.stringify(r));

for (const table of ["plain", "rich"]) {
  console.log(`\n=== ${table} — declared DDL`);
  console.log(rows("SELECT sql FROM sqlite_master WHERE name = ?", [table])[0].sql);
  console.log(`--- ${table} — normalized records`);
  const r = strip(records(table));
  // The table name is the only thing that can differ by design.
  console.log(JSON.stringify(r.columns, null, 1));
  console.log("primaryKeys:", JSON.stringify(r.primaryKeys));
  console.log("foreignKeys:", JSON.stringify(r.foreignKeys));
}

const plain = strip(records("plain"));
const rich = strip(records("rich"));
console.log("\n=== do the records differ at all?");
console.log(JSON.stringify(plain.columns) === JSON.stringify(rich.columns)
  ? "columns: IDENTICAL — UNIQUE and CHECK leave no trace"
  : "columns: differ");
console.log(
  "indexes in the record model:",
  Object.keys(engine.introspection).join(", "),
);
console.log(
  "\nindex objects the DDL declares:",
  rows("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
    .map((r) => r.sql)
    .join("\n"),
);
db.close();
