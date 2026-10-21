// Live probe — sqlite introspection: what the engine will actually tell us.
//
// Task 2.2. This measures BEFORE anything is written into the tables: the point
// is to see the raw shape, not to confirm a shape already assumed.
//
//   node verification/live/introspect-sqlite.mjs
//
// Prints raw pragma rows as JSON. No normalization here — that is the contract's
// job, and it must be designed from this output.

import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");

// Deliberately exercising the facts full introspection must carry: a primary
// key, a foreign key with an action, a declared length, a default, and a
// nullable column.
db.exec(`
CREATE TABLE parent (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE child (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  label VARCHAR(40) DEFAULT 'x',
  note TEXT
);
-- A COMPOSITE foreign key: the shape that a name-only join multiplies.
CREATE TABLE pair (x INTEGER NOT NULL, y INTEGER NOT NULL, PRIMARY KEY (x, y));
CREATE TABLE link (
  id INTEGER PRIMARY KEY,
  x INTEGER, y INTEGER,
  FOREIGN KEY (x, y) REFERENCES pair (x, y) ON DELETE CASCADE
);
`);

const tables = db
  .prepare(
    "SELECT name, type FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all();

const out = { engine: "sqlite", sqliteVersion: db.prepare("SELECT sqlite_version() v").get().v, tables, columns: {}, foreignKeys: {}, indexes: {} };

for (const t of tables) {
  out.columns[t.name] = db.prepare(`PRAGMA table_info(${JSON.stringify(t.name)})`).all();
  out.foreignKeys[t.name] = db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(t.name)})`).all();
  out.indexes[t.name] = db.prepare(`PRAGMA index_list(${JSON.stringify(t.name)})`).all();
}

console.log(JSON.stringify(out, null, 2));
db.close();
