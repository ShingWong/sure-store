// Live probe — Turso (@tursodatabase/database, Node's synchronous ./compat).
//
// Contract-driven, same as the sqlite probe. Skips with a clear message when
// the driver is not installed, so the suite stays runnable without it:
//
//   npm i -D @tursodatabase/database
//   node --experimental-strip-types verification/live/turso.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ftsSyncStatements, getEngine, renderFtsDdl, renderSearch } from "../../impl/ts/index.ts";
import { loadContracts } from "../../impl/ts/index.ts";

let Database;
try {
  ({ Database } = await import("@tursodatabase/database/compat"));
} catch {
  console.log("turso live probe: SKIPPED — install @tursodatabase/database to run it");
  process.exit(0);
}

const engine = getEngine(loadContracts(), "turso");
const dir = mkdtempSync(join(tmpdir(), "sure-store-turso-"));
const db = new Database(join(dir, "probe.db"), { experimental: ["index_method"] });

db.exec(`CREATE TABLE messages (
  account INTEGER NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL,
  subject TEXT, fromaddr TEXT, body_text TEXT, internaldate INTEGER,
  PRIMARY KEY (account, folder, uid))`);

// 1. the rendered DDL applies — one statement, and it is an INDEX, not a table
const ddl = renderFtsDdl(engine, {
  name: "messages_fts",
  table: "messages",
  cols: ["subject", "fromaddr", "body_text"],
});
for (const sql of ddl) db.exec(sql);
assert.equal(ddl.length, 1);

// 2. the engine maintains the index: no sync statements, and a row is found
//    with none emitted
assert.equal(
  ftsSyncStatements(engine, {
    name: "messages_fts",
    table: "messages",
    cols: ["subject", "fromaddr", "body_text"],
    idPredicate: "account = ? AND folder = ? AND uid = ?",
  }).length,
  0,
  "turso maintains its own index — the core emits no sync statements",
);
db.exec(`INSERT INTO messages VALUES
  (1,'INBOX',7,'Quarterly invoice','billing@example.com','Please find the invoice attached',1700000000)`);

// 3. the rendered search finds it with no explicit sync
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

// 4. the trap, asserted so it cannot silently regress: the index NAME parses
//    and returns SILENTLY EMPTY, where the column list works.
const byName = db
  .prepare("SELECT uid FROM messages m WHERE fts_match('messages_fts', ?)")
  .all("invoice");
assert.deepEqual(byName, [], "passing the index name must return silently empty");
const byCols = db
  .prepare("SELECT uid FROM messages m WHERE fts_match(subject, fromaddr, body_text, ?)")
  .all("invoice");
assert.equal(byCols.length, 1, "the column list form must find the row");

db.close();
rmSync(dir, { recursive: true, force: true });
console.log("turso live probe: OK");
console.log("  index-based storage, engine-maintained, 0 sync statements, 1 hit");
console.log("  trap confirmed: fts_match('<index name>', ?) -> [] silently");
