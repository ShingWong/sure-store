// FR-1 measurement — tx + DML capabilities on sqlite and turso.
// A FRESH connection per capability, so transaction state cannot leak between
// probes and produce false failures (the first run had exactly that bug).
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("node:path");

// Scratch databases stay inside the repo and are gitignored. Resolved from this
// file, never from an absolute path — an absolute path here would leak the
// author's directory layout into a public repository.
const SCRATCH = path.join(__dirname, "..", ".scratch");
fs.mkdirSync(SCRATCH, { recursive: true });

let n = 0;
const mkSqlite = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec("INSERT INTO t (id, name) VALUES (1, 'alpha')");
  return db;
};
const mkTurso = () => {
  const { Database } = require("@tursodatabase/database/compat");
  const p = path.join(SCRATCH, `fr1-${n++}.db`);
  fs.rmSync(p, { force: true });
  const db = new Database(p, { experimental: ["index_method", "triggers"] });
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec("INSERT INTO t (id, name) VALUES (1, 'alpha')");
  return db;
};

// ex: statement with no result. q: statement expected to return rows.
const ex = (mk, sql) => {
  const db = mk();
  try { db.exec(sql); db.close(); return "ok"; }
  catch (e) { db.close(); return "FAIL: " + String(e.message).split("\n")[0].slice(0, 44); }
};
const q = (mk, sql) => {
  const db = mk();
  try { db.prepare(sql).all(); db.close(); return "ok"; }
  catch (e) { db.close(); return "FAIL: " + String(e.message).split("\n")[0].slice(0, 44); }
};
const seq = (mk, steps) => {
  const db = mk();
  try {
    for (const s of steps) {
      if (/^\s*(select|pragma)/i.test(s)) db.prepare(s).all(); else db.exec(s);
    }
    db.close();
    return "ok";
  } catch (e) { db.close(); return "FAIL: " + String(e.message).split("\n")[0].slice(0, 44); }
};

const CAPS = [
  ["tx.start BEGIN",            (mk) => ex(mk, "BEGIN")],
  ["tx.start BEGIN IMMEDIATE",  (mk) => ex(mk, "BEGIN IMMEDIATE")],
  ["tx.commit COMMIT",          (mk) => seq(mk, ["BEGIN", "COMMIT"])],
  ["tx.abort ROLLBACK",         (mk) => seq(mk, ["BEGIN", "ROLLBACK"])],
  ["savepoint",                 (mk) => seq(mk, ["BEGIN", "SAVEPOINT sp", "RELEASE sp", "COMMIT"])],
  ["isolation SET TRANSACTION", (mk) => ex(mk, "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")],
  ["forUpdate SELECT..FOR UPDATE", (mk) => q(mk, "SELECT id FROM t WHERE id = 1 FOR UPDATE")],
  ["advisoryLock pg_advisory_lock", (mk) => q(mk, "SELECT pg_advisory_lock(1)")],
  ["returning after INSERT",    (mk) => q(mk, "INSERT INTO t (id, name) VALUES (2,'b') RETURNING id, name")],
  ["onConflict DO UPDATE",      (mk) => ex(mk, "INSERT INTO t (id,name) VALUES (1,'a2') ON CONFLICT (id) DO UPDATE SET name = excluded.name")],
  ["onConflict DO NOTHING",     (mk) => ex(mk, "INSERT INTO t (id,name) VALUES (1,'x') ON CONFLICT (id) DO NOTHING")],
  ["partial unique index",      (mk) => ex(mk, "CREATE UNIQUE INDEX t_name_u ON t (name) WHERE name IS NOT NULL")],
  ["expression index",          (mk) => ex(mk, "CREATE INDEX t_low ON t (lower(name))")],
];

console.log("capability".padEnd(32), "sqlite".padEnd(50), "turso");
console.log("-".repeat(32), "-".repeat(50), "-".repeat(40));
for (const [label, fn] of CAPS) {
  console.log(label.padEnd(32), String(fn(mkSqlite)).padEnd(50), String(fn(mkTurso)));
}
