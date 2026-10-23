// The fixture-format gate is only worth having if it fires. Each rule in
// verification/validate-fixtures.mjs is exercised here against a deliberately
// broken fixture, because a check nobody has seen fail is not a check.
//
// The gate's history is the reason: `{types.timestamptz}` (flat; the real path
// is `types.map.timestamptz`) once survived into SQL as literal text, and a typo
// in `requires.path` once skipped silently. Both are now rejected before a run.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const VALIDATOR = join(ROOT, "verification", "validate-fixtures.mjs");
const CONTRACT = JSON.parse(readFileSync(join(ROOT, "contracts", "engines.json"), "utf8"));

/** A fixture that must pass, so a failing case is known to be the mutation. */
function validCase(extra = {}) {
  return {
    id: "base",
    why: "the control case — if this fails, the mutation is not what failed",
    steps: ["SELECT 1"],
    check: { rows: 1 },
    ...extra,
  };
}

function fixture(overrides = {}, cases = [validCase()]) {
  return {
    formatVersion: 1,
    specVersion: CONTRACT.specVersion,
    id: "test",
    why: "a fixture built by the test",
    cases,
    ...overrides,
  };
}

/** Validate a fixture directory; returns { code, output }. */
function validate(doc) {
  const dir = mkdtempSync(join(tmpdir(), "sure-store-fmt-"));
  try {
    writeFileSync(join(dir, "fixture.json"), JSON.stringify(doc, null, 2));
    try {
      const out = execFileSync(process.execPath, [VALIDATOR, dir], { encoding: "utf8", stdio: "pipe" });
      return { code: 0, output: out };
    } catch (err) {
      return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function rejects(makeDoc, pattern) {
  const { code, output } = validate(makeDoc());
  assert.equal(code, 1, `expected the gate to reject, got exit ${code}:\n${output}`);
  assert.match(output, pattern);
}

test("the control fixture passes", () => {
  const { code, output } = validate(fixture());
  assert.equal(code, 0, output);
  assert.match(output, /all good/);
});

test("an unknown top-level key is rejected — the format is versioned, not open", () => {
  rejects(() => fixture({ case: [] }), /unknown top-level key "case"/);
});

test("an unknown section catches the typo that would validate nothing", () => {
  rejects(() => fixture({ serach: {} }), /unknown top-level key "serach"/);
});

test("a format this runner does not implement is refused", () => {
  rejects(() => fixture({ formatVersion: 2 }), /formatVersion must be 1/);
});

test("a fixture pinned to another spec cannot drift", () => {
  rejects(() => fixture({ specVersion: "9.9.9" }), /specVersion "9\.9\.9" does not match/);
});

test("a case without a reason is folklore and is rejected", () => {
  rejects(() => fixture({}, [{ ...validCase(), why: undefined }]), /why must be a non-empty string/);
});

test("a duplicate case id is rejected", () => {
  rejects(() => fixture({}, [validCase(), validCase()]), /duplicate case id "base"/);
});

test("a scope typo is rejected", () => {
  rejects(() => fixture({}, [validCase({ scope: "expression" })]), /scope "expression" is not one of/);
});

test("requires with both equals and nonEmpty is rejected", () => {
  rejects(
    () => fixture({}, [validCase({ requires: { path: "clock.serverNow", equals: "x", nonEmpty: true } })]),
    /both equals and nonEmpty/,
  );
});

test("requires.path that resolves nowhere is rejected — this used to skip", () => {
  rejects(
    () => fixture({}, [validCase({ requires: { path: "types.timestamptz" } })]),
    /requires\.path "types\.timestamptz" resolves on no engine entry/,
  );
});

test("a token that resolves nowhere is rejected — this used to reach the SQL as text", () => {
  rejects(() => fixture({}, [validCase({ steps: ["CREATE TABLE t (a {types.timestamptz})"] })]), /resolves on no engine entry/);
});

test("{ph} outside a binding-scoped case is rejected", () => {
  rejects(() => fixture({}, [validCase({ steps: ["SELECT 1 LIMIT {ph}"] })]), /binding placeholder/);
});

test("a binding-scoped case may use binding facts", () => {
  const { code, output } = validate(
    fixture({}, [validCase({ scope: "binding", steps: ["SELECT 1 LIMIT {ph}"], check: { fields: ["changes"] } })]),
  );
  assert.equal(code, 0, output);
});

test("check.fields is refused on an engine-scoped case", () => {
  rejects(
    () => fixture({}, [validCase({ check: { rows: 1, fields: ["changes"] } })]),
    /check\.fields asserts the driver envelope/,
  );
});

test("an unknown check key is rejected", () => {
  rejects(() => fixture({}, [validCase({ check: { rows: 1, count: 1 } })]), /check has unknown key "count"/);
});

test("an object step without sql is rejected", () => {
  rejects(() => fixture({}, [validCase({ steps: [{ expects: "reject" }] })]), /must carry a non-empty sql/);
});

test("an empty steps array is rejected", () => {
  rejects(() => fixture({}, [validCase({ steps: [] })]), /steps must be a non-empty array/);
});

test("an invalid expects value is rejected", () => {
  rejects(() => fixture({}, [validCase({ expects: "no" })]), /expects "no" is not one of/);
});

test("an errorMatches that is not a regex is rejected", () => {
  rejects(
    () => fixture({}, [validCase({ steps: [{ sql: "SELECT 1", expects: "reject", errorMatches: "(" }] })]),
    /not a valid regex/,
  );
});

test("a case that is not an object is rejected", () => {
  rejects(() => fixture({}, ["SELECT 1"]), /a case must be an object/);
});
