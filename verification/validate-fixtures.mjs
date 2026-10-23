// sure-store — validate the fixture format itself.
//
// The fixtures are the contract, so the *shape* of a fixture is a contract fact
// too: a third-party runner implements `verification/fixtures/README.md`, and a
// fixture that quietly stops matching that description is a contract change
// nobody announced.
//
// This is a gate, not documentation. Each rule below is proven to fire by
// test/fixture-format.test.mjs, because a check nobody has seen fail is not a
// check.
//
//   node verification/validate-fixtures.mjs [fixtures-dir]

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const DIR = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "verification", "fixtures");

const FORMAT_VERSION = 1;

/**
 * Every top-level key a v1 fixture may carry.
 *
 * This is the extension rule made executable: a new section is a format change,
 * so it has to be added here deliberately. A typo (`case:` for `cases:`) then
 * fails loudly instead of turning the file into one that validates and runs
 * nothing.
 */
const TOP_LEVEL = new Set([
  "formatVersion",
  "specVersion",
  "id",
  "why",
  "note",
  "from",
  "appliesTo",
  "format",
  "checkScope",
  "runnerObligation",
  "invariant",
  "identity",
  "schema",
  "cases",
  "refuses",
  "notes",
  "render",
  "columns",
  "primaryKeys",
  "foreignKeys",
  "statementGuards",
  "matchParam",
  "ftsDdl",
  "ftsSync",
  "ftsTriggers",
  "search",
  "failClosed",
  "placeholder",
  "ftsConfig",
]);

const SCOPES = new Set(["engine", "binding"]);
const EXPECTS = new Set(["ok", "reject"]);
const CHECK_KEYS = new Set(["rows", "first", "fields"]);

const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "engines.json"), "utf8"));
const problems = [];

function fail(file, where, message) {
  problems.push(`${file}${where ? ` ${where}` : ""} — ${message}`);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Scopes a path or token may resolve against.
//
// A behavioural case runs once per engine entry (scope: engine) or once per
// binding with its engine underneath (scope: binding). A path that resolves
// against none of them is a typo — and the runtime would turn it into a FAILURE
// on every engine, or worse, a skip if it were ever read leniently.
// ---------------------------------------------------------------------------

const engineEntries = Object.values(contract.engines);
const bindingScopes = Object.entries(contract.bindings)
  .filter(([, b]) => typeof b !== "string")
  .map(([, b]) => ({ ...contract.engines[b.engine], ...b }));

function resolvesOnAny(scopeName, dotted) {
  const scopes = scopeName === "binding" ? bindingScopes : engineEntries;
  return scopes.some((s) => {
    let cur = s;
    for (const key of dotted.split(".")) {
      if (cur == null || typeof cur !== "object") return false;
      cur = cur[key];
    }
    return cur !== undefined;
  });
}

function tokensIn(text) {
  return [...String(text).matchAll(/\{([\w.]+)\}/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Case validation
// ---------------------------------------------------------------------------

function validateCase(file, c, index, seenIds) {
  const where = `cases[${index}]${c && c.id ? ` (${c.id})` : ""}`;

  if (!isPlainObject(c)) return fail(file, where, "a case must be an object");

  if (typeof c.id !== "string" || c.id.trim() === "") {
    fail(file, where, "id must be a non-empty string");
  } else if (seenIds.has(c.id)) {
    fail(file, where, `duplicate case id "${c.id}"`);
  } else {
    seenIds.add(c.id);
  }

  if (typeof c.why !== "string" || c.why.trim() === "") {
    fail(file, where, "why must be a non-empty string — a case without its reason is folklore");
  }

  const scope = c.scope ?? "engine";
  if (!SCOPES.has(scope)) {
    fail(file, where, `scope "${scope}" is not one of ${[...SCOPES].join(", ")}`);
  }

  if ("expects" in c && !EXPECTS.has(c.expects)) {
    fail(file, where, `expects "${c.expects}" is not one of ${[...EXPECTS].join(", ")}`);
  }

  if ("requires" in c) {
    const r = c.requires;
    if (!isPlainObject(r)) {
      fail(file, where, "requires must be an object");
    } else {
      if (typeof r.path !== "string" || r.path.trim() === "") {
        fail(file, where, "requires.path must be a non-empty string");
      } else if (!resolvesOnAny(scope, r.path)) {
        fail(
          file,
          where,
          `requires.path "${r.path}" resolves on no ${scope} entry — a typo here reads as a skip`,
        );
      }
      if ("equals" in r && "nonEmpty" in r) {
        fail(file, where, "requires has both equals and nonEmpty — the runner honours equals first");
      }
      if ("nonEmpty" in r && typeof r.nonEmpty !== "boolean") {
        fail(file, where, "requires.nonEmpty must be a boolean");
      }
      for (const key of Object.keys(r)) {
        if (!["path", "equals", "nonEmpty"].includes(key)) {
          fail(file, where, `requires has unknown key "${key}"`);
        }
      }
    }
  }

  if (!Array.isArray(c.steps) || c.steps.length === 0) {
    fail(file, where, "steps must be a non-empty array");
  } else {
    c.steps.forEach((step, i) => {
      const stepWhere = `${where} steps[${i}]`;
      if (typeof step === "string") {
        validateTokens(file, stepWhere, step, scope);
        return;
      }
      if (!isPlainObject(step)) return fail(file, stepWhere, "a step must be a string or an object");
      if (typeof step.sql !== "string" || step.sql.trim() === "") {
        return fail(file, stepWhere, "an object step must carry a non-empty sql");
      }
      validateTokens(file, stepWhere, step.sql, scope);
      if ("expects" in step && !EXPECTS.has(step.expects)) {
        fail(file, stepWhere, `expects "${step.expects}" is not one of ${[...EXPECTS].join(", ")}`);
      }
      if ("errorMatches" in step) {
        try {
          new RegExp(step.errorMatches, "i");
        } catch (err) {
          fail(file, stepWhere, `errorMatches is not a valid regex: ${err.message}`);
        }
      }
    });
  }

  if ("check" in c) {
    if (!isPlainObject(c.check)) {
      fail(file, where, "check must be an object");
    } else {
      for (const [key, value] of Object.entries(c.check)) {
        if (!CHECK_KEYS.has(key)) fail(file, where, `check has unknown key "${key}"`);
        if (key === "rows" && typeof value !== "number") fail(file, where, "check.rows must be a number");
        if (key === "fields" && scope !== "binding") {
          fail(file, where, "check.fields asserts the driver envelope, so the case must be binding-scoped");
        }
      }
    }
  }

  if ("binds" in c && !Array.isArray(c.binds)) fail(file, where, "binds must be an array");
  if ("assert" in c && !(Array.isArray(c.assert) && c.assert.every((a) => typeof a === "string"))) {
    fail(file, where, "assert must be an array of strings");
  }
}

function validateTokens(file, where, text, scope) {
  for (const token of tokensIn(text)) {
    if (token === "ph") {
      if (scope !== "binding") {
        fail(file, where, "{ph} is a binding placeholder, so the case must be binding-scoped");
      }
      continue;
    }
    if (!resolvesOnAny(scope, token)) {
      fail(file, where, `{${token}} resolves on no ${scope} entry — it would fail every run, never render`);
    }
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error(`no fixtures found in ${DIR}`);
  process.exit(2);
}

let cases = 0;

for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  } catch (err) {
    fail(file, "", `is not valid JSON: ${err.message}`);
    continue;
  }

  if (!isPlainObject(doc)) {
    fail(file, "", "a fixture must be a JSON object");
    continue;
  }

  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL.has(key)) {
      fail(file, "", `unknown top-level key "${key}" — the fixture format is versioned, so a new section needs a decision`);
    }
  }

  if (doc.formatVersion !== FORMAT_VERSION) {
    fail(
      file,
      "",
      `formatVersion must be ${FORMAT_VERSION} (found ${JSON.stringify(doc.formatVersion)}) — a runner refuses a format it does not implement`,
    );
  }

  if (doc.specVersion !== contract.specVersion) {
    fail(
      file,
      "",
      `specVersion "${doc.specVersion}" does not match the contract's "${contract.specVersion}"`,
    );
  }

  if (typeof doc.id !== "string" || doc.id.trim() === "") fail(file, "", "id must be a non-empty string");
  if (!(typeof doc.why === "string" || typeof doc.note === "string")) {
    fail(file, "", "a fixture must say why it exists (why or note)");
  }

  // Behavioural files are the ones whose cases carry steps. The render-side
  // fixtures (types, introspection) use a different shape and are validated by
  // their own runner's expectations.
  // A non-object case can only be a behavioural defect: types.json's cases are
  // objects without steps, so this keeps them out without trusting the filename.
  const behavioural =
    Array.isArray(doc.cases) && doc.cases.some((c) => !isPlainObject(c) || "steps" in c);
  if (behavioural) {
    const seen = new Set();
    doc.cases.forEach((c, i) => {
      validateCase(file, c, i, seen);
      cases += 1;
    });
  }
}

console.log(
  `fixture format v${FORMAT_VERSION} — ${files.length} files, ${cases} behavioural cases checked against spec ${contract.specVersion}`,
);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log("all good");
