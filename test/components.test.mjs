// The catalog verification gates, proven to fire.
//
// A check nobody has seen fail is not a check. These pin the dependency-free
// transcription of the published sure-factor 0.6 / sure-ui 0.3.6 shapes, the
// synthetic-fixture policy, the guard evaluator, and the golden drift gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseYaml } from "../verification/components/mini-yaml.mjs";
import {
  COMPONENT_FAMILIES,
  isDocumentPart,
  validateDocumentPart,
  registryIssues,
  projectionRefs,
} from "../verification/components/validate.mjs";
import { runGuards } from "../verification/components/evaluate.mjs";
import { syntheticIssues, fixtureAmounts, rowCount } from "../verification/components/synthetic.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");

/** The published sure-factor catalog.test.ts REPORT_YAML, verbatim in spirit. */
const REPORT_YAML = `
name: document-table
description: Repeating rows with a repeated header, kept together on a page.
tier: prototype
family: data
data:
  entity: invoices
  projection: [line_number, due_on, amount]
  shape: rows
print:
  keepTogether: true
  breakBefore: false
  repeatHeader: true
guards:
  - "totals.grand_total == sum(rows.amount)"
fixture:
  input: { rows: [{ line_number: 1, due_on: "2031-04-15", amount: 120.00 }] }
  expect: { html_contains: ["$120.00"], pages: 1 }
sure_ui: [table, form, buttons]
cssClasses:
  form: sure-table
  row: sure-table__row
  cell: sure-table__cell
`;

function report() {
  return parseYaml(REPORT_YAML, "report.yaml");
}

/** A real entry's fixture carries the synthetic provenance REPORT_YAML omits. */
function realFixture() {
  const text = readFileSync(join(ROOT, "components", "document-table.yaml"), "utf8");
  return parseYaml(text, "document-table.yaml").fixture.input;
}

test("the local reader matches the published parser on the catalog's YAML subset", () => {
  const c = report();
  assert.equal(c.name, "document-table");
  assert.deepEqual(c.data, {
    entity: "invoices",
    projection: ["line_number", "due_on", "amount"],
    shape: "rows",
  });
  assert.deepEqual(c.print, { keepTogether: true, breakBefore: false, repeatHeader: true });
  assert.deepEqual(c.guards, ["totals.grand_total == sum(rows.amount)"]);
  assert.deepEqual(c.fixture.input, {
    rows: [{ line_number: 1, due_on: "2031-04-15", amount: 120 }],
  });
  assert.deepEqual(c.sure_ui, ["table", "form", "buttons"]);
  assert.equal(c.fixture.expect.pages, 1);
});

test("the reader fails closed on YAML it does not implement", () => {
  assert.throws(() => parseYaml("name: x\nvalue: &anchor 1\n", "bad.yaml"), /unsupported YAML syntax/);
  assert.throws(() => parseYaml("name: x\n   bad: 1\n", "bad.yaml"), /multiple of 2/);
});

test("validator: the closed sets and a valid report entry", () => {
  assert.deepEqual([...COMPONENT_FAMILIES], ["structure", "data", "figure"]);
  assert.equal(isDocumentPart(report()), true);
  assert.equal(isDocumentPart({ name: "form", sure_ui: ["form", "buttons"] }), false);
  assert.deepEqual(validateDocumentPart(report()), []);
});

test("validator: guards may only name declared projections", () => {
  const c = report();
  c.guards = ["totals.grand_total == sum(rows.not_a_column)"];
  const issues = validateDocumentPart(c);
  assert.ok(issues.some((i) => i.code === "UNKNOWN_PROJECTION"));
  assert.match(issues[0].message, /not_a_column/);
  assert.match(issues[0].message, /data\.projection/);
});

test("validator: computed totals, params and built-ins are not projections", () => {
  const c = report();
  c.guards = ["totals.grand_total == sum(rows.amount)", "F:due_on != P:as_of"];
  assert.deepEqual(validateDocumentPart(c), []);
  assert.deepEqual(projectionRefs("totals.grand_total == sum(rows.amount)"), ["amount"]);
});

test("validator: guards with no projection, bad family and bad shape fail", () => {
  const noProjection = report();
  noProjection.data = { entity: "invoices", shape: "rows" };
  assert.ok(validateDocumentPart(noProjection).some((i) => i.code === "GUARD_WITHOUT_PROJECTION"));

  const bad = report();
  bad.family = "report";
  bad.data.shape = "grid";
  const codes = validateDocumentPart(bad).map((i) => i.code);
  assert.ok(codes.includes("BAD_FAMILY"));
  assert.ok(codes.includes("BAD_SHAPE"));
});

test("registry: template blocks and class families are required", () => {
  assert.deepEqual(registryIssues(report()), []);
  const sloppy = report();
  sloppy.sure_ui = ["table"];
  sloppy.cssClasses.graphic = "sure-document__graphic";
  const codes = registryIssues(sloppy).map((i) => i.code);
  assert.ok(codes.includes("MISSING_TEMPLATE_BLOCK"));
  assert.ok(codes.includes("UNDECLARED_CLASS_FAMILY"));

  const unpublished = report();
  unpublished.sure_ui = ["table", "form", "buttons", "not-a-block"];
  assert.ok(registryIssues(unpublished).some((i) => i.code === "UNKNOWN_BLOCK"));
});

test("published blocks document and figure are accepted", () => {
  const c = report();
  c.sure_ui = ["document", "figure", "table", "form", "buttons"];
  assert.deepEqual(registryIssues(c), []);
});

test("synthetic policy fires on every provenance rule", () => {
  const base = realFixture();
  assert.deepEqual(syntheticIssues(base), []);

  const notSynthetic = structuredClone(base);
  delete notSynthetic.synthetic;
  assert.ok(syntheticIssues(notSynthetic).some((s) => /synthetic/.test(s)));

  const noSeed = structuredClone(base);
  delete noSeed.seed;
  assert.ok(syntheticIssues(noSeed).some((s) => /seed/.test(s)));

  const wrongDate = structuredClone(base);
  wrongDate.generatedAt = "2027-01-01";
  assert.ok(syntheticIssues(wrongDate).some((s) => /seed's date/.test(s)));

  const past = structuredClone(base);
  past.rows[0].due_on = "2020-01-01";
  assert.ok(syntheticIssues(past).some((s) => /not in the future/.test(s)));

  const realName = structuredClone(base);
  realName.rows[0].description = "Jane Doe";
  assert.ok(syntheticIssues(realName).some((s) => /invented name/.test(s)));

  const identifier = structuredClone(base);
  identifier.rows[0].description = "acct 123456";
  assert.ok(syntheticIssues(identifier).some((s) => /long digit run/.test(s)));
});

test("fixture helpers derive the golden facts", () => {
  const input = report().fixture.input;
  assert.deepEqual(fixtureAmounts(input), ["$120.00"]);
  assert.equal(rowCount(input), 1);
});

test("guard evaluator computes arithmetic and refuses unknown functions", () => {
  const c = report();
  assert.deepEqual(runGuards(c.guards, c.fixture.input), {
    "totals.grand_total == sum(rows.amount)": false, // REPORT_YAML has no totals figure
  });
  const reconciled = structuredClone(c.fixture.input);
  reconciled.totals = { grand_total: 120 };
  assert.deepEqual(runGuards(c.guards, reconciled), {
    "totals.grand_total == sum(rows.amount)": true,
  });
  assert.throws(() => runGuards(["mystery(rows.amount)"], reconciled), /unknown function/);
});

test("the entries and goldens ship, and the verify chain includes the replay", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.ok(pkg.files.includes("components"), "the catalog entries must be published");
  assert.equal(pkg.scripts["verify:components"], "node --experimental-strip-types verification/run-components.mjs");
  assert.match(pkg.scripts.verify, /verify:components/);
  for (const name of ["document-table", "document-totals", "document-keyvalue", "document-schedule", "document-graphic"]) {
    assert.ok(existsSync(join(ROOT, "components", `${name}.yaml`)));
    assert.ok(existsSync(join(ROOT, "components", "fixtures", `${name}.golden.json`)));
  }
});

test("drift in an entry fails the replay loudly", () => {
  const tmp = mkdtempSync(join(tmpdir(), "sure-store-components-"));
  try {
    const comps = join(tmp, "components");
    mkdirSync(join(comps, "fixtures"), { recursive: true });
    const src = join(ROOT, "components");
    const yamlFiles = readdirSync(src).filter((x) => x.endsWith(".yaml"));
    for (const f of yamlFiles) copyFileSync(join(src, f), join(comps, f));
    for (const f of readdirSync(join(src, "fixtures"))) {
      copyFileSync(join(src, "fixtures", f), join(comps, "fixtures", f));
    }
    const target = join(comps, "document-table.yaml");
    writeFileSync(target, readFileSync(target, "utf8").replace("repeatHeader: true", "repeatHeader: false"));

    const run = spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "verification", "run-components.mjs"),
        "--components", comps, "--goldens", join(comps, "fixtures")],
      { encoding: "utf8" },
    );
    assert.notEqual(run.status, 0, "a drifted entry must fail the gate");
    assert.match(`${run.stdout}${run.stderr}`, /golden drift/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
