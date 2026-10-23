// The driver's conformance test: the fixtures are the contract, so the driver is
// checked by running them through the shared runner — not by a bespoke harness
// that could drift from what the contract demands.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { assertBindingSupported, binding, open } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(here, "..", "dist", "index.js");
const ROOT = join(here, "..", "..", "..");

test("the Queryable shape does what a caller needs", () => {
  const db = open();
  try {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const info = db.run("INSERT INTO t (name) VALUES (?)", ["a"]);
    assert.equal(info.changes, 1);
    assert.equal(Number(info.lastInsertRowid), 1);
    // node:sqlite returns null-prototype rows; that is the binding's shape, not
    // the driver's business to rewrite, so compare field by field.
    const rows = db.all("SELECT id, name FROM t");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 1);
    assert.equal(rows[0].name, "a");
  } finally {
    db.close();
  }
});

test("the driver believes the contract about itself, and refuses otherwise", () => {
  assert.equal(binding, "node:sqlite");
  // The real contract describes this binding.
  assertBindingSupported();
  // A contract that says something else is a defect, not something to guess at.
  assert.throws(
    () =>
      assertBindingSupported({
        bindings: {
          "node:sqlite": { params: "positional-dollar", result: { affectedField: "rowCount" } },
        },
      }),
    /declares params "positional-dollar"/,
  );
  assert.throws(
    () => assertBindingSupported({ bindings: {} }),
    /does not describe the "node:sqlite" binding/,
  );
});

test("the behavioural fixtures pass through this driver", () => {
  const out = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      join(ROOT, "verification", "run-behaviour.mjs"),
      "--driver",
      `node:sqlite=${DRIVER}`,
      "--verbose",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );

  // The run must actually have gone through the driver, not the built-in
  // adapter — a conformance test that silently falls back proves nothing.
  assert.match(out, /node:sqlite via .*dist\/index\.js/);
  assert.match(out, /0 failed/);

  const passed = Number(/(\d+) passed/.exec(out)?.[1] ?? "0");
  assert.ok(passed > 20, `expected the binding-scoped suite to run, got ${passed} passed`);
});
