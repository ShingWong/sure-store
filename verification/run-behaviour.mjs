// sure-store — behavioural fixture runner.
//
// Runs verification/fixtures/*.json (except render.json, which the reference
// renderer's runner owns) against real engines.
//
// Dependency-free on purpose: sqlite comes from node:sqlite, so CI needs no
// install. Engines whose driver or server is absent are SKIPPED and reported as
// skips — never as passes, and never as failures. "This engine cannot express
// it" and "this engine failed it" are different facts and only one is a defect.
//
//   node verification/run-behaviour.mjs [--verbose]

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const VERBOSE = process.argv.includes("--verbose");

const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "engines.json"), "utf8"));

const returnsRows = (sql) => /^\s*(select|with|pragma)\b/i.test(sql);

// ---------------------------------------------------------------------------
// Adapters — one tiny surface per engine, and `info` is the RAW driver result.
// It is not normalised: normalising it would hide the very fact that
// binding-scoped cases exist to assert.
// ---------------------------------------------------------------------------

function nodeSqlite() {
  return {
    label: "node:sqlite",
    open() {
      const db = new DatabaseSync(":memory:");
      return {
        exec(sql, params = []) {
          if (returnsRows(sql)) return { rows: db.prepare(sql).all(...params), info: null };
          // Single statements go through prepare().run() so the DRIVER envelope
          // is available — that envelope is exactly what binding-scoped cases
          // assert. Multi-statement blobs can only go through exec().
          const single = !sql.trim().replace(/;\s*$/, "").includes(";");
          if (single) return { rows: null, info: db.prepare(sql).run(...params) };
          db.exec(sql);
          return { rows: null, info: null };
        },
        close() {
          db.close();
        },
      };
    },
  };
}

async function turso() {
  let mod;
  try {
    mod = await import("@tursodatabase/database/compat");
  } catch {
    return null;
  }
  return {
    label: "@tursodatabase/database/compat",
    open() {
      const dir = mkdtempSync(join(tmpdir(), "sure-store-b-"));
      const db = new mod.Database(join(dir, "probe.db"), {
        experimental: ["index_method", "triggers"],
      });
      return {
        exec(sql, params = []) {
          if (returnsRows(sql)) return { rows: db.prepare(sql).all(...params), info: null };
          // Single statements go through prepare().run() so the DRIVER envelope
          // is available — that envelope is exactly what binding-scoped cases
          // assert. Multi-statement blobs can only go through exec().
          const single = !sql.trim().replace(/;\s*$/, "").includes(";");
          if (single) return { rows: null, info: db.prepare(sql).run(...params) };
          db.exec(sql);
          return { rows: null, info: null };
        },
        close() {
          db.close();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  };
}

/** The adapter for an engine, or null when it cannot run here. */
async function adapterFor(engine) {
  if (engine === "sqlite") return nodeSqlite();
  if (engine === "turso") return turso();
  // postgres: this runner is dependency-free, so it has no driver to reach a
  // server with. The live probes under verification/live/ cover it.
  return null;
}

/** The adapter for a binding, or null. Keyed by binding, not engine. */
async function adapterForBinding(bindingName) {
  if (bindingName === "node:sqlite") return nodeSqlite();
  if (bindingName === "@tursodatabase/database/compat") return turso();
  return null; // pg: no dependency-free driver
}

// ---------------------------------------------------------------------------
// Contract resolution
// ---------------------------------------------------------------------------

function resolvePath(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Resolve a contract path, or fail loudly.
 *
 * `undefined` must never be read as a fact. A path that does not resolve is a
 * FIXTURE or CONTRACT defect, and reading it as "absent" makes the case skip —
 * indistinguishable from an engine that genuinely lacks the capability. That is
 * the "passed by never running" class, and fail-closed has to govern the
 * resolver, not only the engine.
 *
 * Measured before this landed: `{types.timestamptz}` (flat; the real path is
 * `types.map.timestamptz`) survived into the SQL as literal text, and a typo in
 * `requires.path` silently skipped.
 */
function resolveStrict(scope, path, where) {
  const value = resolvePath(scope, path);
  if (value === undefined) {
    throw new Error(
      `unresolved contract path "${path}" (${where}) — no such fact. ` +
        `Paths are nested: types.map.jsonb, bindings.<driver>.result.affectedField.`,
    );
  }
  return value;
}

/** Does a case run against this entry? See fixtures/README.md. */
function satisfies(requires, scope) {
  if (!requires) return { run: true, why: "no requirement" };
  const value = resolveStrict(scope, requires.path, "requires");
  if ("equals" in requires) {
    return { run: value === requires.equals, why: `${requires.path} === ${JSON.stringify(requires.equals)}` };
  }
  if (requires.nonEmpty) {
    const run = Array.isArray(value) ? value.length > 0 : Boolean(value);
    return { run, why: `${requires.path} non-empty` };
  }
  return { run: Boolean(value), why: `${requires.path} truthy` };
}

/**
 * Replace {path} tokens from the scope, and {ph} with the placeholder for this
 * binding. {ph} occurrences are numbered in order, so a dollar-style binding
 * renders `LIMIT $1 OFFSET $2`.
 *
 * An unresolved token is a FAILURE, not literal text — see resolveStrict.
 */
function substitute(text, scope, paramsStyle) {
  let ph = 0;
  return String(text).replace(/\{([\w.]+)\}/g, (_whole, path) => {
    if (path === "ph") {
      ph += 1;
      return paramsStyle === "positional-dollar" ? `$${ph}` : "?";
    }
    const value = resolveStrict(scope, path, `{${path}} in SQL`);
    return String(value);
  });
}

// ---------------------------------------------------------------------------
// Resolver self-check — prove the fail-closed behaviour actually fires.
//
// A check that only ever passes is worthless, and this one guards the exact
// seam that let a typo become a skip: the resolver. Run by `npm run ci`.
// ---------------------------------------------------------------------------
if (process.argv.includes("--self-check")) {
  const sqliteEngine = contract.engines.sqlite;
  const pgBinding = { ...contract.engines.postgres, ...contract.bindings.pg };
  let defects = 0;

  const mustThrow = (name, fn) => {
    try {
      fn();
      console.log(`  NOT THROWING — ${name}`);
      defects += 1;
    } catch {
      console.log(`  fires — ${name}`);
    }
  };
  const mustResolve = (name, fn) => {
    try {
      fn();
      console.log(`  resolves — ${name}`);
    } catch (err) {
      console.log(`  WRONGLY THREW — ${name}: ${err.message}`);
      defects += 1;
    }
  };

  // The failures: a flat path where the contract nests (the exact slip made in a
  // real contribution), and a path scoped to the wrong axis.
  mustThrow("requires: nested path written flat", () =>
    satisfies({ path: "types.timestamptz" }, sqliteEngine),
  );
  mustThrow("requires: binding fact read off the engine", () =>
    satisfies({ path: "result.affectedField" }, sqliteEngine),
  );
  mustThrow("substitute: nested token written flat", () =>
    substitute("SELECT {types.timestamptz}", sqliteEngine, null),
  );

  // The controls: real paths must still resolve, or the check is a brick wall.
  mustResolve("requires: the nested form of the path that just failed", () =>
    satisfies({ path: "types.map.timestamptz" }, sqliteEngine),
  );
  mustResolve("substitute: real nested engine fact", () =>
    substitute("SELECT {types.map.timestamptz}", sqliteEngine, null),
  );
  mustResolve("requires: binding fact under its binding", () =>
    satisfies({ path: "result.affectedField" }, pgBinding),
  );

  console.log(defects === 0 ? "resolver self-check: OK" : "resolver self-check: FAILED");
  process.exit(defects === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Case execution
// ---------------------------------------------------------------------------

const fail = (message) => ({ status: "FAIL", message });

function checkResult(check, last) {
  if (!check) return null;
  if ("rows" in check) {
    const n = (last.rows ?? []).length;
    if (n !== check.rows) return fail(`expected ${check.rows} row(s), got ${n}`);
  }
  if (check.first) {
    const row = (last.rows ?? [])[0];
    if (!row) return fail("expected a row for `first`, got none");
    for (const [col, expected] of Object.entries(check.first)) {
      if (row[col] !== expected) {
        return fail(`column ${col}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(row[col])}`);
      }
    }
  }
  if (check.fields) {
    const keys = Object.keys(last.info ?? {});
    for (const field of check.fields) {
      if (!keys.includes(field)) return fail(`driver result lacks "${field}" (has: ${keys.join(", ") || "none"})`);
    }
  }
  return null;
}

function runCase(conn, caseDef, scope, paramsStyle) {
  const steps = caseDef.steps.map((s) => (typeof s === "string" ? { sql: s } : s));
  const caseRejects = (caseDef.expects ?? "ok") === "reject";
  const single = steps.length === 1;

  let last = { rows: null, info: null };
  let rejections = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const expectsReject =
      step.expects === "reject" || (caseRejects && i === steps.length - 1);
    const sql = substitute(step.sql, scope, paramsStyle);
    // `binds` applies to the final step — the one whose result is checked.
    const params = i === steps.length - 1 ? caseDef.binds ?? [] : [];
    try {
      last = conn.exec(sql, params);
      if (expectsReject) return fail(`step ${i + 1} should have been refused but succeeded: ${sql}`);
    } catch (err) {
      const message = String(err && err.message).split("\n")[0];
      if (!expectsReject) return fail(`step ${i + 1} threw: ${message}\n         ${sql}`);
      rejections += 1;
      const pattern = step.errorMatches ?? caseDef.errorMatches;
      if (pattern && !new RegExp(pattern, "i").test(message)) {
        return fail(`step ${i + 1} threw but not /${pattern}/i: ${message}`);
      }
      last = { rows: null, info: null };
    }
  }

  if (caseRejects && rejections === 0) return fail("case expects a refusal; none occurred");
  return checkResult(caseDef.check, last) ?? { status: "PASS" };
}

/** Set up the fixture's base schema on a fresh connection. */
function seed(conn, fixture, scope, paramsStyle) {
  for (const sql of fixture.schema ?? []) conn.exec(substitute(sql, scope, paramsStyle));
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const FIXTURES = ["tx.json", "stmt-shape.json"];
const counts = { pass: 0, skip: 0, fail: 0 };
const failures = [];
const skips = [];

/** Run one case once, on a fresh connection. */
function attempt(file, caseDef, scope, adapter, paramsStyle, label) {
  let gate;
  try {
    gate = satisfies(caseDef.requires, scope);
  } catch (err) {
    // An unresolvable requires.path is a fixture defect, not an engine property.
    // It must be a FAILURE: a skip here is indistinguishable from a genuine
    // capability gap, which is how a typo becomes a green run.
    counts.fail += 1;
    failures.push(
      `${file} ${caseDef.id} [${label}] — ${String(err && err.message).split("\n")[0]}`,
    );
    if (VERBOSE) console.log(`  FAIL ${caseDef.id} [${label}]`);
    return;
  }
  if (!gate.run) {
    counts.skip += 1;
    skips.push(`${file} ${caseDef.id} [${label}] — not declared (${gate.why})`);
    if (VERBOSE) console.log(`  SKIP ${caseDef.id} [${label}] — ${gate.why}`);
    return;
  }
  if (!adapter) {
    counts.skip += 1;
    skips.push(`${file} ${caseDef.id} [${label}] — no dependency-free driver here`);
    if (VERBOSE) console.log(`  SKIP ${caseDef.id} [${label}] — no driver`);
    return;
  }
  const fixture = FIXTURES_CACHE[file];
  const conn = adapter.open();
  let result;
  try {
    seed(conn, fixture, scope, paramsStyle);
    result = runCase(conn, caseDef, scope, paramsStyle);
  } catch (err) {
    // A failure while seeding is a fixture or contract defect, not a crash of
    // the runner: report it with the case so it is actionable.
    result = fail(`setup threw: ${String(err && err.message).split("\n")[0]}`);
  } finally {
    conn.close();
  }
  if (result.status === "PASS") counts.pass += 1;
  else {
    counts.fail += 1;
    failures.push(`${file} ${caseDef.id} [${label}] — ${result.message}`);
  }
  if (VERBOSE) console.log(`  ${result.status} ${caseDef.id} [${label}]`);
}

const FIXTURES_CACHE = {};
for (const file of FIXTURES) {
  FIXTURES_CACHE[file] = JSON.parse(
    readFileSync(join(ROOT, "verification", "fixtures", file), "utf8"),
  );
}

for (const file of FIXTURES) {
  const fixture = FIXTURES_CACHE[file];
  if (VERBOSE) console.log(`\n${file} — ${fixture.id}`);

  // Engine-scoped cases: once per engine.
  for (const engine of Object.keys(contract.engines)) {
    const entry = contract.engines[engine];
    const adapter = await adapterFor(engine);
    for (const caseDef of fixture.cases) {
      if ((caseDef.scope ?? "engine") !== "engine") continue;
      attempt(file, caseDef, entry, adapter, null, engine);
    }
  }

  // Binding-scoped cases: once per binding, because their facts are the
  // driver's. The scope merges the binding over its engine so `types.*` and
  // `clock.*` still resolve while `result.*` and `params` come from the binding.
  for (const [name, binding] of Object.entries(contract.bindings)) {
    if (typeof binding === "string") continue; // the "note"
    const engineEntry = contract.engines[binding.engine];
    const scope = { ...engineEntry, ...binding };
    const adapter = await adapterForBinding(name);
    for (const caseDef of fixture.cases) {
      if ((caseDef.scope ?? "engine") !== "binding") continue;
      attempt(file, caseDef, scope, adapter, binding.params, name);
    }
  }
}

console.log(`\nbehavioural fixtures — ${counts.pass} passed, ${counts.skip} skipped, ${counts.fail} failed`);
if (VERBOSE) for (const s of skips) console.log(`  SKIP ${s}`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (counts.fail > 0) process.exit(1);
console.log("all good");
