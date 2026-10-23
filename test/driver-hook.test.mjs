// `--driver <binding>=<path>` is the seam that lets a driver package prove
// itself against the fixtures. Its failure modes matter more than its happy
// path: every one of them must be loud, because the alternative is a run that
// silently falls back to the built-in adapter and reports a pass.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const RUNNER = join(ROOT, "verification", "run-behaviour.mjs");

function run(args) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", RUNNER, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function withTempModule(source, fn) {
  const dir = mkdtempSync(join(tmpdir(), "sure-store-driver-"));
  try {
    const file = join(dir, "driver.mjs");
    writeFileSync(file, source);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a binding the contract does not declare is refused before any case runs", () => {
  const { status, out } = run(["--driver", "node:sqllite=/tmp/nope.js"]);
  assert.equal(status, 2);
  assert.match(out, /--driver names binding "node:sqllite", which the contract does not declare/);
  // The contract's own bindings are listed, so the typo is visible next to the truth.
  assert.match(out, /declared: node:sqlite, @tursodatabase\/database\/compat, pg/);
});

test("a driver module without open() fails the run instead of falling back", () => {
  withTempModule("export const binding = 'node:sqlite';\n", (file) => {
    const { status, out } = run(["--driver", `node:sqlite=${file}`]);
    assert.notEqual(status, 0);
    assert.match(out, /does not export open\(\)/);
  });
});

test("a driver path that does not exist fails the run", () => {
  const { status, out } = run(["--driver", "node:sqlite=/tmp/definitely-not-here.mjs"]);
  assert.notEqual(status, 0);
  assert.match(out, /ERR_MODULE_NOT_FOUND|Cannot find module/);
});

test("a driver that opens but throws on the first statement reports a failure, not a pass", () => {
  const source = `
    export function open() {
      return {
        all() { throw new Error("driver exploded"); },
        run() { throw new Error("driver exploded"); },
        exec() { throw new Error("driver exploded"); },
        close() {},
      };
    }
  `;
  withTempModule(source, (file) => {
    const { status, out } = run(["--driver", `node:sqlite=${file}`]);
    assert.notEqual(status, 0);
    assert.match(out, /driver exploded/);
    assert.doesNotMatch(out, /all good/);
  });
});
