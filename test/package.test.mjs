// Packaging: the published entry must be runnable by a compiled consumer.
//
// sure-factor ships dist/*.js on plain node >= 20, so a package whose `exports`
// point at raw `.ts` is unusable from the registry — which is what this repo
// used to do. The static half of this test runs everywhere (including the
// install-free gate job); the dynamic half needs a build, so it skips with a
// stated reason rather than passing by never running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

test("the published entry is compiled, not raw TypeScript", () => {
  const entry = pkg.exports?.["."];
  assert.ok(entry, "package.json must export '.'");
  const target = typeof entry === "string" ? entry : entry.import;
  assert.ok(target, "the '.' export must have an import target");
  assert.ok(
    !target.endsWith(".ts"),
    `the entry points at ${target} — a compiled consumer (sure-factor runs plain node >= 20) cannot load that`,
  );
  assert.match(target, /\.js$/, "the entry must be compiled JavaScript");
  assert.ok(
    typeof entry === "object" && entry.types?.endsWith(".d.ts"),
    "the entry must ship types for TypeScript consumers",
  );
});

test("the package ships the contract beside the code", () => {
  // load.ts walks up from its own module to find contracts/engines.json, so the
  // published tarball must carry both dist/ and contracts/.
  assert.ok(pkg.files?.includes("dist"), "files must include dist");
  assert.ok(pkg.files?.includes("contracts"), "files must include contracts");
  assert.equal(pkg.exports?.["./contracts"], "./contracts/engines.json");
  // The fixtures ARE the contract: a published package whose consumer cannot
  // read them makes "a runner is correct when it satisfies them" unverifiable
  // from the only artifact most consumers ever see.
  assert.ok(pkg.files?.includes("verification/fixtures"), "files must include the fixtures");
  assert.ok(pkg.files?.includes("docs"), "files must include the guide");
});

test("the built package imports under plain node", async (t) => {
  const dist = join(ROOT, "dist", "index.js");
  if (!existsSync(dist)) {
    t.skip("no dist/ — run `npm run build` (the gate job does not install a toolchain)");
    return;
  }

  // No --experimental-strip-types: this is exactly what a consumer does.
  const mod = await import(dist);
  const engines = mod.loadContracts();
  assert.ok(engines.sqlite && engines.turso && engines.postgres, "the contract loads from the package");
  assert.equal(typeof mod.renderSearch, "function");

  const sql = mod.renderSearch(mod.getEngine(engines, "sqlite"), {
    name: "messages_fts",
    table: "messages",
    cols: ["subject"],
    select: "m.uid",
    orderBy: "m.internaldate",
    terms: ["x"],
    limit: 5,
  }).sql;
  assert.match(sql, /MATCH \?/, "the compiled renderer still renders");
});
