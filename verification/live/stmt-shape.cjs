// FR-2 measurement — the statement-shape axes, on sqlite and turso.
// Six asks: params, clock, types, result envelope, serverInfo, identifierQuote.
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
  const p = path.join(SCRATCH, `fr2-${n++}.db`);
  fs.rmSync(p, { force: true });
  const db = new Database(p, { experimental: ["index_method", "triggers"] });
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec("INSERT INTO t (id, name) VALUES (1, 'alpha')");
  return db;
};

const q = (mk, sql, params) => {
  const db = mk();
  try {
    const rows = db.prepare(sql).all(...(params ?? []));
    db.close();
    return "ok " + JSON.stringify(rows).slice(0, 46);
  } catch (e) { db.close(); return "FAIL: " + String(e.message).split("\n")[0].slice(0, 44); }
};
const ex = (mk, sql) => {
  const db = mk();
  try { db.exec(sql); db.close(); return "ok"; }
  catch (e) { db.close(); return "FAIL: " + String(e.message).split("\n")[0].slice(0, 44); }
};
const run = (mk, sql, params) => {
  const db = mk();
  try { const r = db.prepare(sql).run(...(params ?? [])); db.close(); return "ok " + JSON.stringify(r); }
  catch (e) { db.close(); return "FAIL: " + String(e.message).split("\n")[0].slice(0, 44); }
};

const row = (label, fn) => {
  console.log("  " + label.padEnd(42), String(fn(mkSqlite)).padEnd(52), String(fn(mkTurso)));
};

console.log("ASK 1 — params".padEnd(46), "sqlite".padEnd(52), "turso");
console.log("-".repeat(140));
row("WHERE id = $1", (mk) => q(mk, "SELECT id FROM t WHERE id = $1", [1]));
row("WHERE id = ?", (mk) => q(mk, "SELECT id FROM t WHERE id = ?", [1]));
row("WHERE id = :name", (mk) => q(mk, "SELECT id FROM t WHERE id = :name", [1]));
row("LIMIT ? bound", (mk) => q(mk, "SELECT id FROM t LIMIT ?", [5]));
row("LIMIT $1 bound", (mk) => q(mk, "SELECT id FROM t LIMIT $1", [5]));
row("LIMIT ? OFFSET ? bound", (mk) => q(mk, "SELECT id FROM t LIMIT ? OFFSET ?", [5, 0]));
row("LIMIT $1 OFFSET $2 bound", (mk) => q(mk, "SELECT id FROM t LIMIT $1 OFFSET $2", [5, 0]));

console.log("\nASK 2 — clock".padEnd(46), "sqlite".padEnd(52), "turso");
console.log("-".repeat(140));
row("SELECT now()", (mk) => q(mk, "SELECT now() AS v"));
row("SELECT CURRENT_TIMESTAMP", (mk) => q(mk, "SELECT CURRENT_TIMESTAMP AS v"));
row("DEFAULT now() in DDL", (mk) => ex(mk, "CREATE TABLE c1 (a TEXT DEFAULT now())"));
row("DEFAULT CURRENT_TIMESTAMP in DDL", (mk) => ex(mk, "CREATE TABLE c2 (a TEXT DEFAULT CURRENT_TIMESTAMP)"));
row("value shape", (mk) => q(mk, "SELECT typeof(CURRENT_TIMESTAMP) AS t, CURRENT_TIMESTAMP AS v"));

console.log("\nASK 3 — types".padEnd(46), "sqlite".padEnd(52), "turso");
console.log("-".repeat(140));
row("DDL with TIMESTAMPTZ/BOOLEAN/JSONB", (mk) => ex(mk, "CREATE TABLE ty (a TIMESTAMPTZ, b BOOLEAN, c JSONB)"));
row("affinity assigned (pragma_table_info)", (mk) => q(mk, "SELECT name, type FROM pragma_table_info('ty')"));
row("round-trip a JSON string", (mk) => { try { const db = mk(); db.exec("CREATE TABLE ty2 (c JSONB)"); db.prepare("INSERT INTO ty2 (c) VALUES (?)").run('{"k":1}'); const r = db.prepare("SELECT c, typeof(c) AS t FROM ty2").all(); db.close(); return "ok " + JSON.stringify(r); } catch (e) { return "FAIL: " + String(e.message).slice(0, 40); } });

console.log("\nASK 4 — result envelope (the driver's own shape)".padEnd(46), "sqlite".padEnd(52), "turso");
console.log("-".repeat(140));
row("run(INSERT) -> envelope", (mk) => run(mk, "INSERT INTO t (id, name) VALUES (2, 'b')"));
row("run(UPDATE) -> envelope", (mk) => run(mk, "UPDATE t SET name = 'z' WHERE id = 1"));
row("run(DELETE) -> envelope", (mk) => run(mk, "DELETE FROM t WHERE id = 1"));

console.log("\nASK 5 — serverInfo".padEnd(46), "sqlite".padEnd(52), "turso");
console.log("-".repeat(140));
row("SELECT sqlite_version()", (mk) => q(mk, "SELECT sqlite_version() AS v"));
row("SELECT version()", (mk) => q(mk, "SELECT version() AS v"));
row("SELECT sqlite_source_id()", (mk) => q(mk, "SELECT sqlite_source_id() AS v"));

console.log("\nASK 6 — identifierQuote".padEnd(46), "sqlite".padEnd(52), "turso");
console.log("-".repeat(140));
row('"select" as a column (double quote)', (mk) => ex(mk, 'CREATE TABLE q1 ("select" TEXT)'));
row("`select` as a column (backtick)", (mk) => ex(mk, "CREATE TABLE q2 (`select` TEXT)"));
row("[select] as a column (bracket)", (mk) => ex(mk, "CREATE TABLE q3 ([select] TEXT)"));
