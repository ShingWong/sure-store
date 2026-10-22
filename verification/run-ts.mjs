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
  renderPlaceholder,
  renderSearch,
  renderIntrospection,
  normalizeColumns,
  normalizeForeignKeys,
  normalizePrimaryKeys,
  applyNullability,
} from "../impl/ts/index.ts";
import { canonicalType, loadContracts, loadDocument, specVersion } from "../impl/ts/index.ts";

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

console.log("placeholder");
for (const c of fixtures.placeholder.styles) {
  check(
    `${c.style} placeholder #${c.index} (${fixtures.placeholder.why})`,
    renderPlaceholder(c.style, c.index),
    c.expects,
  );
}
for (const c of fixtures.placeholder.refuses) {
  let threw = false;
  try {
    renderPlaceholder(c.style, 1);
  } catch {
    threw = true;
  }
  check(
    `placeholder '${c.style}' refuses (${c.why})`,
    threw,
    true,
  );
}
{
  // Compose-time, end to end: the same search statement, spelled for a binding
  // that only accepts $n. Two placeholders, numbered in the order they bind.
  const pg = renderSearch(getEngine(engines, "postgres"), {
    ...fixtures.placeholder.search.input,
    params: "positional-dollar",
  });
  check(
    "postgres search composed for positional-dollar",
    pg.sql,
    fixtures.placeholder.search.pg,
  );
  // The literal `?` in a jsonb-shaped statement must survive: nothing rewrites
  // it, because nothing in this design rewrites SQL after the fact.
  check(
    "a literal ? is not a placeholder",
    renderPlaceholder("positional-dollar", 2),
    "$2",
  );
}

console.log("introspection — render");
{
  const introspect = JSON.parse(readFileSync(join(here, "fixtures", "introspect.json"), "utf8"));
  for (const c of introspect.render.cases) {
    const out = renderIntrospection(getEngine(engines, c.engine), c.section, {
      table: c.table,
      schema: c.schema,
    });
    if (c.sql !== undefined) check(`${c.engine} ${c.section} sql`, out.sql, c.sql);
    if (c.params !== undefined) check(`${c.engine} ${c.section} params`, out.params, c.params);
    if (c.placeholderCount !== undefined) {
      check(`${c.engine} ${c.section} placeholder count`, (out.sql.match(/\?/g) ?? []).length, c.placeholderCount);
    }
  }
  for (const c of introspect.render.refuses) {
    let threw = false;
    try {
      renderIntrospection(getEngine(engines, c.engine), c.section, { table: "t", schema: "public" });
    } catch {
      threw = true;
    }
    check(`introspection ${c.engine} ${c.section} refuses (${c.why})`, threw, true);
  }

  for (const g of introspect.statementGuards ?? []) {
    const { sql } = renderIntrospection(getEngine(engines, g.engine), g.section, {
      table: "t",
      schema: "public",
    });
    for (const needle of g.contains) {
      check(`${g.engine} ${g.section} statement contains ${needle}`, sql.includes(needle), true);
    }
    for (const needle of g.absent) {
      check(`${g.engine} ${g.section} statement avoids ${needle}`, sql.includes(needle), false);
    }
  }

  console.log("introspection — normalize");
  for (const [name, c] of Object.entries(introspect.columns)) {
    const engine = getEngine(engines, name);
    const columns = normalizeColumns(engine, c.rows, { table: c.table });
    const keys = normalizePrimaryKeys(engine, [], columns);
    check(
      `${name} columns → nullability (${introspect.why})`,
      applyNullability(columns, keys).map((x) => ({
        name: x.name,
        nullable: x.nullable,
        primaryKeyPosition: x.primaryKeyPosition,
      })),
      c.expects,
    );
  }

  for (const [name, c] of Object.entries(introspect.primaryKeys)) {
    const engine = getEngine(engines, name);
    const columns = c.deriveFromColumns
      ? normalizeColumns(engine, introspect.columns[name].rows, { table: introspect.columns[name].table })
      : undefined;
    check(
      `${name} primary keys`,
      normalizePrimaryKeys(engine, c.rows, columns),
      c.expects,
    );
  }

  for (const [name, c] of Object.entries(introspect.foreignKeys)) {
    if (typeof c !== "object" || !c.rows) continue;
    const engine = getEngine(engines, name);
    check(
      `${name} foreign keys — grouped, ordered, no cross product`,
      normalizeForeignKeys(engine, c.rows, { table: c.table }).map((k) => ({
        table: k.table,
        columns: k.columns,
        refTable: k.refTable,
        refColumns: k.refColumns,
      })),
      c.expects,
    );
  }
}

console.log("canonical types");
{
  const types = JSON.parse(readFileSync(join(here, "fixtures", "types.json"), "utf8"));
  const doc = loadDocument();
  for (const c of types.cases) {
    check(
      `${c.engine} ${c.raw || "(empty declaration)"} -> ${c.expects}`,
      canonicalType(getEngine(engines, c.engine), c.raw, doc.typeAxis),
      c.expects,
    );
  }
  for (const c of types.refuses) {
    let threw = false;
    try {
      canonicalType(getEngine(engines, c.engine), c.raw, doc.typeAxis);
    } catch {
      threw = true;
    }
    check(`${c.engine} ${c.raw} refuses (${c.why})`, threw, true);
  }
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
