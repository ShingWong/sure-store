// sure-store — catalog component verification.
//
// Replays the five document-part entries in components/*.yaml: validates the
// published sure-factor 0.6 extension keys, checks the sure-factor template
// coverage from sure-ui 0.3.6, enforces the synthetic-fixture policy, runs the
// guards against each fixture, and compares the derived facts with the
// committed golden in components/fixtures/<name>.golden.json. A drift in an
// entry (or in a golden) fails loudly.
//
// Dependency-free: the CI gate job installs nothing. The validation logic in
// verification/components/ is a transcription of the published packages and
// is itself pinned by test/components.test.mjs.
//
//   node verification/run-components.mjs [--update]

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseYaml } from "./components/mini-yaml.mjs";
import {
  isDocumentPart,
  validateDocumentPart,
  registryIssues,
  projectionRefs,
} from "./components/validate.mjs";
import { runGuards } from "./components/evaluate.mjs";
import {
  syntheticIssues,
  fixtureStrings,
  fixtureAmounts,
  rowCount,
} from "./components/synthetic.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** Optional path overrides let the gate test replay a drifted copy in a temp dir. */
function optionValue(flag, fallback) {
  const at = process.argv.indexOf(flag);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${flag} expects a path`);
    process.exit(2);
  }
  return value;
}

const COMPONENTS = optionValue("--components", join(ROOT, "components"));
const GOLDENS = optionValue("--goldens", join(COMPONENTS, "fixtures"));
const UPDATE = process.argv.includes("--update");

const EXPECTED = [
  "document-table",
  "document-totals",
  "document-keyvalue",
  "document-schedule",
  "document-graphic",
];

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function buildGolden(component, problems) {
  const label = component.name || "unnamed";
  const required = ["family", "data", "print", "guards", "fixture", "sure_ui", "cssClasses"];
  for (const key of required) {
    if (component[key] === undefined) problems.push(`${label}: missing required key "${key}"`);
  }
  if (!isDocumentPart(component)) problems.push(`${label}: not a document part`);

  for (const i of validateDocumentPart(component)) problems.push(`${label}: ${i.code}: ${i.message}`);
  for (const i of registryIssues(component)) problems.push(`${label}: ${i.code}: ${i.message}`);

  const input = component.fixture?.input;
  const expect = component.fixture?.expect;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    problems.push(`${label}: fixture.input must be a mapping`);
  }
  if (!expect || typeof expect !== "object" || Array.isArray(expect)) {
    problems.push(`${label}: fixture.expect must be a mapping`);
  }
  for (const i of syntheticIssues(input)) problems.push(`${label}: ${i}`);

  const guards = component.guards ?? [];
  const projection = component.data?.projection ?? [];
  const guardRefs = [...new Set(guards.flatMap((g) => projectionRefs(g)))].sort();
  for (const ref of guardRefs) {
    if (!projection.includes(ref)) problems.push(`${label}: guard reference "${ref}" is not in data.projection`);
  }

  let guardResults = {};
  if (input && guards.length > 0) {
    try {
      guardResults = runGuards(guards, input);
    } catch (err) {
      problems.push(`${label}: guard evaluation failed: ${err.message}`);
    }
  }
  const guardsPass = Object.keys(guardResults).length > 0 && Object.values(guardResults).every(Boolean);
  if (expect?.guards_pass !== true) problems.push(`${label}: fixture.expect.guards_pass must be true`);
  if (expect?.guards_pass === true && !guardsPass) {
    problems.push(`${label}: guards did not all pass against the fixture: ${JSON.stringify(guardResults)}`);
  }

  const count = input ? rowCount(input) : 0;
  if (expect?.row_count !== undefined && expect.row_count !== count) {
    problems.push(`${label}: expect.row_count ${expect.row_count} != fixture rows ${count}`);
  }
  if (!Number.isInteger(expect?.pages) || expect.pages < 1) {
    problems.push(`${label}: expect.pages must be a positive integer`);
  }

  const haystack = input ? `${fixtureStrings(input)}\n${fixtureAmounts(input).join("\n")}` : "";
  for (const needle of expect?.html_contains ?? []) {
    if (typeof needle !== "string" || !haystack.includes(needle)) {
      problems.push(`${label}: expect.html_contains "${needle}" is not derivable from the fixture`);
    }
  }

  const replay = {
    row_count: count,
    amounts: input ? fixtureAmounts(input) : [],
    guards_pass: guardsPass,
    html_contains: expect?.html_contains ?? [],
  };
  return {
    name: component.name,
    family: component.family,
    data: component.data,
    print: component.print,
    guards: component.guards,
    projectionRefs: guardRefs,
    guardResults,
    sure_ui: component.sure_ui,
    cssClasses: component.cssClasses,
    fixture: component.fixture,
    replay,
    contractDigest: digest({
      family: component.family,
      data: component.data,
      print: component.print,
      guards: component.guards,
      fixture: component.fixture,
      sure_ui: component.sure_ui,
      cssClasses: component.cssClasses,
    }),
  };
}

const files = readdirSync(COMPONENTS).filter((f) => f.endsWith(".yaml")).sort();
const names = files.map((f) => f.replace(/\.yaml$/, ""));
const problems = [];
let checked = 0;

for (const expected of EXPECTED) {
  if (!names.includes(expected)) problems.push(`missing catalog entry: ${expected}.yaml`);
}
for (const name of names) {
  if (!EXPECTED.includes(name)) problems.push(`unexpected catalog entry: ${name}.yaml (update EXPECTED deliberately)`);
}

for (const file of files) {
  const name = file.replace(/\.yaml$/, "");
  let component;
  try {
    component = parseYaml(readFileSync(join(COMPONENTS, file), "utf8"), file);
  } catch (err) {
    problems.push(`${name}: YAML parse failed: ${err.message}`);
    continue;
  }

  const entryProblems = [];
  const golden = buildGolden(component, entryProblems);
  if (entryProblems.length > 0) {
    problems.push(...entryProblems);
    continue;
  }
  checked++;

  const goldenPath = join(GOLDENS, `${name}.golden.json`);
  if (UPDATE) {
    mkdirSync(GOLDENS, { recursive: true });
    writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`);
    console.log(`  updated ${name}.golden.json`);
    continue;
  }
  if (!existsSync(goldenPath)) {
    problems.push(`${name}: missing golden ${goldenPath} (run with --update to create it)`);
    continue;
  }
  let recorded;
  try {
    recorded = JSON.parse(readFileSync(goldenPath, "utf8"));
  } catch (err) {
    problems.push(`${name}: golden is not valid JSON: ${err.message}`);
    continue;
  }
  if (JSON.stringify(recorded) !== JSON.stringify(golden)) {
    problems.push(
      `${name}: golden drift — the entry no longer produces the committed golden ` +
        `(run with --update, then review the diff and state the reason)`,
    );
  }
}

if (UPDATE) {
  console.log(`catalog fixtures — ${checked} golden(s) updated`);
  process.exit(problems.length > 0 ? 1 : 0);
}

console.log(`catalog fixtures — ${checked} of ${EXPECTED.length} entries replayed`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("all good");
