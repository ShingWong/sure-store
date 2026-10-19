// sure-store verification — run the language-neutral fixtures against the
// TypeScript reference renderer.
//
// This is the shape every other language's runner should take: read
// contracts/engines.json, read verification/fixtures/, compare, exit non-zero
// on any mismatch. If a Python or AssemblyScript renderer satisfies the same
// fixtures, it agrees with this one.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ftsSyncStatements,
  getEngine,
  renderFtsDdl,
  renderFtsTriggers,
  renderMatchParam,
  renderSearch,
} from "../impl/ts/index.ts";
import { loadContracts, specVersion } from "../impl/ts/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, "fixtures", "render.json"), "utf8"),
);
const engines = loadContracts();

const ENGINES = ["sqlite", "turso", "postgres"];
let checks = 0;
let failed = 0;

function check(label, actual, expected) {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed += 1;
    console.log(`  FAIL ${label}`);
    console.log(`       expected ${e}`);
    console.log(`       actual   ${a}`);
  }
}

console.log(
  `sure-store verification — spec ${specVersion()}, fixtures ${fixtures.specVersion}`,
);

console.log("match param");
for (const c of fixtures.matchParam) {
  for (const name of ENGINES) {
    check(
      `${name} terms=${JSON.stringify(c.terms)} (${c.why})`,
      renderMatchParam(getEngine(engines, name), c.terms),
      c[name],
    );
  }
}

console.log("fts ddl");
for (const name of ENGINES) {
  check(
    `${name} fts ddl`,
    renderFtsDdl(getEngine(engines, name), fixtures.ftsDdl.input),
    fixtures.ftsDdl[name],
  );
}

console.log("fts sync");
for (const name of ENGINES) {
  check(
    `${name} sync statement count (${fixtures.ftsSync.why})`,
    ftsSyncStatements(getEngine(engines, name), {
      name: fixtures.ftsDdl.input.name,
      table: fixtures.ftsDdl.input.table,
      cols: fixtures.ftsDdl.input.cols,
      idPredicate: "account = ? AND folder = ? AND uid = ?",
    }).length,
    fixtures.ftsSync[name],
  );
}

console.log("fts triggers");
for (const name of ENGINES) {
  check(
    `${name} fts triggers (${fixtures.ftsTriggers.why})`,
    renderFtsTriggers(getEngine(engines, name), fixtures.ftsTriggers.input),
    fixtures.ftsTriggers[name],
  );
}

console.log("search");
for (const name of ENGINES) {
  const rendered = renderSearch(getEngine(engines, name), fixtures.search.input);
  check(`${name} search sql (${fixtures.search.why})`, rendered.sql, fixtures.search[name].sql);
  check(`${name} search params`, rendered.params, fixtures.search[name].params);
}

console.log("fail closed");
{
  let threw = false;
  let message = "";
  try {
    getEngine(engines, fixtures.failClosed.unknownEngine);
  } catch (err) {
    threw = true;
    message = String(err && err.message);
  }
  check(
    `unknown engine '${fixtures.failClosed.unknownEngine}' throws (${fixtures.failClosed.why})`,
    threw && /refusing to guess/.test(message),
    true,
  );
}

console.log(`\n${checks - failed}/${checks} checks passed`);
if (failed > 0) {
  console.log(`${failed} FAILED`);
  process.exit(1);
}
console.log("all good");
