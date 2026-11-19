/**
 * The structural half of the synthetic-fixture policy (docs/acceptance.md §1,
 * §2): seeded, `"synthetic": true`, invented names, round amounts, future
 * dates, and no string that looks like a real identifier.
 *
 * The private denylist does NOT live here — that is the consumer's CI job.
 * These are the checks a public repository can honestly make about itself.
 */

const NAME_KEYS = new Set(["description", "alt", "name", "person", "customer", "company"]);
const AMOUNT_KEYS = new Set(["amount", "late_fee", "subtotal", "tax", "grand_total"]);
const IDENTIFIER_PATTERNS = [
  ["SSN", /\b\d{3}-\d{2}-\d{4}\b/],
  ["phone", /\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/],
  ["long digit run", /\b\d{6,}\b/],
  ["email", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ["key material", /-----BEGIN/],
];

function walk(value, key, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, key, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) walk(child, childKey, visit);
    return;
  }
  visit(key, value);
}

/** All issues found in one fixture input; empty means the policy holds. */
export function syntheticIssues(input, today = "2026-11-19") {
  const issues = [];
  const add = (message) => issues.push(message);
  const where = input && typeof input === "object" ? input.__file ?? "fixture" : "fixture";

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [`${where}: fixture.input must be a mapping`];
  }
  if (input.synthetic !== true) add(`${where}: missing "synthetic": true`);

  const seed = input.seed;
  if (!Number.isInteger(seed)) add(`${where}: seed must be an integer`);
  const seedDate =
    typeof seed === "number"
      ? `${String(Math.trunc(seed)).padStart(8, "0").slice(0, 4)}-${String(Math.trunc(seed)).padStart(8, "0").slice(4, 6)}-${String(Math.trunc(seed)).padStart(8, "0").slice(6, 8)}`
      : "";
  if (typeof input.generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.generatedAt)) {
    add(`${where}: generatedAt must be a YYYY-MM-DD string (the seed's date, not the clock)`);
  } else if (input.generatedAt !== seedDate) {
    add(`${where}: generatedAt "${input.generatedAt}" is not the seed's date "${seedDate}"`);
  }

  walk(input, "", (key, value) => {
    if (typeof value !== "string") return;
    if (key === "generatedAt") return;
    for (const [label, pattern] of IDENTIFIER_PATTERNS) {
      if (pattern.test(value)) add(`${where}: ${label}-shaped string under "${key}"`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today) {
      add(`${where}: date "${value}" under "${key}" is not in the future`);
    }
    if (NAME_KEYS.has(key) && !/^(?:Test|Example|Sample|Demo)\b/.test(value)) {
      add(`${where}: "${value}" under "${key}" is not an invented name`);
    }
  });

  walk(input, "", (key, value) => {
    if (typeof value !== "number" || !AMOUNT_KEYS.has(key)) return;
    if (!Number.isInteger(value * 100)) add(`${where}: ${key}=${value} is not a two-decimal amount`);
    if (value < 0) add(`${where}: ${key}=${value} is negative — fixtures use round positive amounts`);
  });

  return issues;
}

/** Every string in an input, plus formatted amounts — the golden's haystack. */
export function fixtureStrings(input) {
  const strings = [];
  walk(input, "", (_key, value) => {
    if (typeof value === "string") strings.push(value);
  });
  return strings.join("\n");
}

/** Formatted `$X.00` strings for every declared amount in the input. */
export function fixtureAmounts(input) {
  const amounts = [];
  walk(input, "", (key, value) => {
    if (typeof value === "number" && AMOUNT_KEYS.has(key)) amounts.push(`$${value.toFixed(2)}`);
  });
  return [...new Set(amounts)].sort();
}

/** Row count for either shape, used by the replay facts. */
export function rowCount(input) {
  if (Array.isArray(input.rows)) return input.rows.length;
  if (Array.isArray(input.record)) return input.record.length;
  return 0;
}
