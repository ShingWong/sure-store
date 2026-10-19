// Live probe — sqlite (node:sqlite, built in; FTS5 present in SQLite 3.51.3).
//
// Contract-driven: the SQL is rendered from contracts/engines.json, so this
// probe proves BOTH the table's claims and the reference renderer against a
// real engine. If the table drifts from reality, this fails.
//
//   node --experimental-strip-types verification/live/sqlite.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { ftsSyncStatements, getEngine, renderFtsDdl, renderSearch } from "../../impl/ts/index.ts";
import { loadContracts } from "../../impl/ts/index.ts";

const engine = getEngine(loadContracts(), "sqlite");
const db = new DatabaseSync(":memory:");

// The consumer's table, minimal.
db.exec(`CREATE TABLE messages (
  account INTEGER NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL,
  subject TEXT, fromaddr TEXT, body_text TEXT, internaldate INTEGER,
  PRIMARY KEY (account, folder, uid))`);

// 1. the rendered search index DDL applies
const ddl = renderFtsDdl(engine, {
  name: "messages_fts",
  table: "messages",
  cols: ["subject", "fromaddr", "body_text"],
});
for (const sql of ddl) db.exec(sql);
assert.equal(ddl.length, 1, "sqlite materialises the index in one statement");

// 2. rows, then the sync statements — sqlite is the engine where the CORE
//    maintains the index, so these must exist and must work.
db.exec(`INSERT INTO messages VALUES
  (1,'INBOX',7,'Quarterly invoice','billing@vendor.com','Please find the invoice attached',1700000000),
  (1,'INBOX',8,'Renewal notice','billing@vendor.com','Your subscription renews',1700000001)`);
const sync = ftsSyncStatements(engine, {
  name: "messages_fts",
  table: "messages",
  cols: ["subject", "fromaddr", "body_text"],
  idPredicate: "account = ? AND folder = ? AND uid = ?",
});
assert.equal(sync.length, 2, "sqlite needs the external-content sync pair");
db.prepare(sync[0]).run(1, "INBOX", 7);
db.prepare(sync[1]).run(1, "INBOX", 7);
db.prepare(sync[0]).run(1, "INBOX", 8);
db.prepare(sync[1]).run(1, "INBOX", 8);

// 3. the rendered search finds it
const search = renderSearch(engine, {
  table: "messages",
  name: "messages_fts",
  cols: ["subject", "fromaddr", "body_text"],
  select: "m.uid, m.folder, m.subject, m.fromaddr, m.internaldate",
  orderBy: "m.internaldate",
  terms: ["invoice"],
  limit: 50,
});
const rows = db.prepare(search.sql).all(...search.params);
assert.equal(rows.length, 1, `expected one hit for 'invoice', got ${rows.length}`);
assert.equal(rows[0].uid, 7);

// 4. the mirror image of the Turso trap: here the predicate names the TABLE,
//    and the column-list form that works on Turso does not work here.
assert.throws(
  () => db.prepare("SELECT uid FROM messages m WHERE fts_match(subject, ?)").all("invoice"),
  /no such function: fts_match/,
  "sqlite must not accept Turso's fts_match column form",
);

console.log("sqlite live probe: OK");
console.log(`  ${ddl.length} ddl statement, ${sync.length} sync statements, 1 hit, fts_match rejected as expected`);
