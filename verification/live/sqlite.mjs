// Live probe — sqlite (node:sqlite, built in; FTS5 present in SQLite 3.51.3).
//
// Contract-driven: the SQL is rendered from contracts/engines.json, so this
// probe proves BOTH the table's claims and the reference renderer against a
// real engine. If the table drifts from reality, this fails.
//
//   node --experimental-strip-types verification/live/sqlite.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  ftsSyncStatements,
  getEngine,
  renderFtsDdl,
  renderFtsTriggers,
  renderSearch,
} from "../../impl/ts/index.ts";
import { loadContracts } from "../../impl/ts/index.ts";

const engine = getEngine(loadContracts(), "sqlite");
const opts = { name: "messages_fts", table: "messages", cols: ["subject", "fromaddr", "body_text"] };
const db = new DatabaseSync(":memory:");

// The consumer's table, minimal.
db.exec(`CREATE TABLE messages (
  account INTEGER NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL,
  subject TEXT, fromaddr TEXT, body_text TEXT, internaldate INTEGER, flags TEXT,
  PRIMARY KEY (account, folder, uid))`);

// 1. the rendered search index DDL applies
const ddl = renderFtsDdl(engine, opts);
for (const sql of ddl) db.exec(sql);
assert.equal(ddl.length, 1, "sqlite materialises the index in one statement");

// 2. the SCHEMA owns upkeep — the trigger trio is what keeps it current
const triggers = renderFtsTriggers(engine, opts);
assert.equal(triggers.length, 3, "insert / delete / update triggers");
for (const sql of triggers) db.exec(sql);

// 3. therefore the core emits NO runtime sync statements
assert.equal(
  ftsSyncStatements(engine, { ...opts, idPredicate: "account = ? AND folder = ? AND uid = ?" }).length,
  0,
  "triggers own upkeep; the core must emit nothing",
);

// 4. rows go in with no explicit index statement, and are found
db.exec(`INSERT INTO messages (account, folder, uid, subject, fromaddr, body_text, internaldate) VALUES
  (1,'INBOX',7,'Quarterly invoice','billing@example.com','Please find the invoice attached',1700000000),
  (1,'INBOX',8,'Renewal notice','billing@example.com','Your subscription renews',1700000001)`);

const search = renderSearch(engine, {
  ...opts,
  select: "m.uid, m.folder, m.subject, m.fromaddr, m.internaldate",
  orderBy: "m.internaldate",
  terms: ["invoice"],
  limit: 50,
});
const rows = db.prepare(search.sql).all(...search.params);
assert.equal(rows.length, 1, `expected one hit for 'invoice', got ${rows.length}`);
assert.equal(rows[0].uid, 7);

// 5. the UPDATE trigger follows a changed indexed column, and its guard leaves
//    a flags-only update alone
db.prepare("UPDATE messages SET body_text = ? WHERE uid = 7").run("Rewritten about quarterly invoices");
assert.deepEqual(
  db.prepare(search.sql).all(...search.params).map((r) => r.uid),
  [7],
  "the rewritten body is still found",
);
db.prepare("UPDATE messages SET flags = ? WHERE uid = 7").run("[]");

// 6. the DELETE trigger removes the entry — the 'delete' command an external
//    content table requires. A direct DELETE of the row is what used to happen,
//    and it is not valid.
db.prepare("DELETE FROM messages WHERE uid = 7").run();
assert.deepEqual(db.prepare(search.sql).all(...search.params), [], "the deleted row is gone");
db.prepare("INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')").run();

// 7. the mirror image of the Turso trap: here the predicate names the TABLE,
//    and the column-list form that works on Turso does not work here.
assert.throws(
  () => db.prepare("SELECT uid FROM messages m WHERE fts_match(subject, ?)").all("invoice"),
  /no such function: fts_match/,
  "sqlite must not accept Turso's fts_match column form",
);

console.log("sqlite live probe: OK");
console.log("  1 ddl statement + 3 triggers, 0 core sync statements");
console.log("  insert/update/delete all maintain the index; integrity-check passed");
