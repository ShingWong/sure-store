/**
 * Document-part validation, transcribed from the PUBLISHED
 * `@shing.wong/sure-factor@0.6.0` `dist/catalog.js` and `dist/types.d.ts`.
 *
 * sure-store's gate jobs install nothing, so we cannot import sure-factor at
 * run time. This module is a literal transcription of the published shapes,
 * not a re-derivation:
 *
 *   - COMPONENT_FAMILIES / DATA_SHAPES / ComponentData / ComponentPrint /
 *     ComponentFixture come from `dist/types.d.ts`;
 *   - projectionRefs / validateDocumentPart come from `dist/catalog.js`;
 *   - COMPONENTS comes from `@shing.wong/sure-ui@0.3.6` `dist/compose.js`.
 *
 * `test/components.test.mjs` pins the transcribed behaviour with the exact
 * guard examples from the published code, so a silent drift in this copy is
 * caught. Full upstream validation still happens in sure-factor's own CI;
 * this gate answers the sure-store question "do our entries satisfy it?".
 */

/** The closed set of document-part families (sure-factor 0.6.0). */
export const COMPONENT_FAMILIES = ["structure", "data", "figure"];
/** The closed set of data shapes (sure-factor 0.6.0). */
export const DATA_SHAPES = ["record", "rows", "series", "none", "derived"];
/** Published sure-ui 0.3.6 COMPONENTS — the only blocks an entry may declare. */
export const COMPONENTS = [
  "auth", "buttons", "composites", "crud", "dialog", "document", "figure",
  "footer", "form", "markdown", "menu", "modal", "page", "regions", "search",
  "sessions", "sidepanel", "status", "table", "toast",
  "mail-action-bar", "mail-compose", "mail-folder-tree",
  "mail-list", "mail-search", "mail-thread",
];

/** Bindings whose dotted leaves are projection names (e.g. `rows.amount`). */
const ROW_BINDINGS = new Set([
  "rows", "row", "record", "data", "series", "item", "fields", "input",
]);
/** Words that are operators, builtins or computed namespaces, not projections. */
const NON_PROJECTIONS = new Set([
  "true", "false", "null", "undefined", "and", "or", "not", "in",
  "sum", "sub", "ifpresent", "min", "max", "count", "abs", "round", "len",
  "totals", "F", "P",
]);

/** True when an entry opts into the document-part extension. */
export function isDocumentPart(component) {
  return (
    component.family !== undefined ||
    component.data !== undefined ||
    component.print !== undefined ||
    component.guards !== undefined ||
    component.fixture !== undefined
  );
}

/**
 * Extract every projection name a guard references — a scanner, not an
 * evaluator (no dynamic code execution). Transcribed verbatim from 0.6.0.
 */
export function projectionRefs(expr) {
  const refs = new Set();
  for (const m of expr.matchAll(/\bF:([A-Za-z_]\w*)/g)) {
    refs.add(m[1]);
  }
  const params = [...expr.matchAll(/\bP:([A-Za-z_]\w*)/g)].map((m) => m[1]);
  for (const m of expr.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)) {
    if (ROW_BINDINGS.has(m[1])) refs.add(m[2]);
  }
  for (const m of expr.matchAll(/\b([A-Za-z_]\w*)\b(?!\s*\()/g)) {
    const id = m[1];
    if (NON_PROJECTIONS.has(id) || params.includes(id)) continue;
    if (new RegExp(`\\.${id}\\b`).test(expr)) continue;
    if (new RegExp(`\\b${id}\\s*\\.`).test(expr)) continue;
    refs.add(id);
  }
  return [...refs];
}

/** Validate the extension keys. Empty issues === safe to generate from. */
export function validateDocumentPart(component) {
  if (!isDocumentPart(component)) return [];
  const issues = [];
  const label = component.name || "unnamed component";
  if (component.family !== undefined && !COMPONENT_FAMILIES.includes(component.family)) {
    issues.push({
      code: "BAD_FAMILY",
      message: `${label}: family "${component.family}" is not one of ${COMPONENT_FAMILIES.join(", ")}`,
    });
  }
  if (component.data?.shape !== undefined && !DATA_SHAPES.includes(component.data.shape)) {
    issues.push({
      code: "BAD_SHAPE",
      message: `${label}: data.shape "${component.data.shape}" is not one of ${DATA_SHAPES.join(", ")}`,
    });
  }
  if (
    component.fixture !== undefined &&
    (typeof component.fixture !== "object" ||
      component.fixture === null ||
      Array.isArray(component.fixture))
  ) {
    issues.push({ code: "BAD_FIXTURE", message: `${label}: fixture must be a mapping` });
  }
  const guards = component.guards ?? [];
  const projection = component.data?.projection ?? [];
  if (guards.length > 0 && projection.length === 0) {
    issues.push({
      code: "GUARD_WITHOUT_PROJECTION",
      message: `${label}: declares guards but no data.projection to check them against`,
    });
  }
  for (const guard of guards) {
    for (const ref of projectionRefs(guard)) {
      if (!projection.includes(ref)) {
        issues.push({
          code: "UNKNOWN_PROJECTION",
          message:
            `${label}: guard "${guard}" references projection "${ref}" ` +
            `which is not declared in data.projection [${projection.join(", ")}]`,
        });
      }
    }
  }
  return issues;
}

/** cssClasses value → the sure-ui family whose block must style it. */
export function familyOf(cssClass) {
  const first = String(cssClass).split(/\s+/)[0];
  if (first.startsWith("sure-")) return first.slice(5).split(/[-_]/)[0];
  if (first.startsWith("btn-")) return "buttons";
  if (first.startsWith("msg-")) return "sessions";
  return null;
}

/**
 * sure-store's additional contract for these entries: the two template
 * families must be declared (sure-factor's generator emits a form wrapper and
 * a submit button for every catalog component), every cssClasses family must
 * be declared, and every declared block must exist in published sure-ui.
 */
export function registryIssues(component) {
  const issues = [];
  const label = component.name || "unnamed component";
  const blocks = new Set(component.sure_ui ?? []);
  for (const required of ["form", "buttons"]) {
    if (!blocks.has(required)) {
      issues.push({
        code: "MISSING_TEMPLATE_BLOCK",
        message: `${label}: sure_ui must declare "${required}" (sure-factor's template emits it for every component)`,
      });
    }
  }
  if (!component.cssClasses?.form && !blocks.has("form")) {
    issues.push({
      code: "MISSING_FORM_CLASS",
      message: `${label}: cssClasses.form or sure_ui 'form' is required for the template wrapper`,
    });
  }
  for (const value of Object.values(component.cssClasses ?? {})) {
    const fam = familyOf(value);
    if (fam && !blocks.has(fam)) {
      issues.push({
        code: "UNDECLARED_CLASS_FAMILY",
        message: `${label}: cssClasses uses "${value}" → family "${fam}" is not in sure_ui`,
      });
    }
  }
  for (const block of blocks) {
    if (!COMPONENTS.includes(block)) {
      issues.push({
        code: "UNKNOWN_BLOCK",
        message: `${label}: sure_ui "${block}" is not a published sure-ui block`,
      });
    }
  }
  return issues;
}
