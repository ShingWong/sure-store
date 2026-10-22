// The canonical type axis: what an engine STORES, mapped to one vocabulary.
//
// Two directions exist in this contract and must not be confused:
//
//   types.map        logical -> engine DDL     (GENERATION: what to declare)
//   types.canonical  engine  -> canonical axis (INTROSPECTION: what it became)
//
// This module is the second one. It is deliberately strict: a type the tables do
// not describe is an ERROR, never "other" and never a guess, because a consumer
// that silently treats citext as text has lost the reason it chose citext.

import type { EngineContract, TypeAxis } from "./render.ts";

export interface AffinityRule {
  match: "contains" | "contains-or-empty" | "otherwise";
  values?: string[];
  canonical: string;
}

/**
 * Map one raw engine type onto the canonical axis.
 *
 * - `affinity` engines (sqlite, turso) pass the DECLARED type text; the rules do
 *   the rest, because the engine stores by affinity and nothing is enforced. An
 *   empty declaration is a real case and lands on BLOB affinity.
 * - `udt_name` engines (postgres) pass the internal type name; the map is the
 *   contract, and a miss refuses.
 */
export function canonicalType(engine: EngineContract, raw: string | null, axis: TypeAxis): string {
  const spec = engine.types?.canonical;
  if (!spec) {
    throw new Error("no canonical type mapping is declared for this engine — refusing to guess");
  }

  let canonical: string;
  if (spec.by === "affinity") {
    canonical = byAffinity(raw, axis);
  } else if (spec.by === "udt_name") {
    if (raw === null || raw === "") {
      throw new Error("a udt_name mapping needs a type name, got none");
    }
    const mapped = spec.map?.[raw];
    if (!mapped) {
      throw new Error(
        `unmapped type "${raw}" on this engine — the tables do not describe it, so it refuses rather than becoming "other"`,
      );
    }
    canonical = mapped;
  } else {
    throw new Error(`unknown type-mapping strategy "${String((spec as { by: string }).by)}"`);
  }

  if (!axis.canonical.includes(canonical)) {
    throw new Error(`"${canonical}" is not on the declared canonical axis — the contract disagrees with itself`);
  }
  return canonical;
}

/** Apply the declared affinity rules, in order. Order is load-bearing. */
function byAffinity(raw: string | null, axis: TypeAxis): string {
  const declared = (raw ?? "").toUpperCase();
  for (const rule of axis.affinity.rules) {
    if (rule.match === "otherwise") return rule.canonical;
    const values = rule.values ?? [];
    const contains = values.some((v) => declared.includes(v.toUpperCase()));
    if (rule.match === "contains" && contains) return rule.canonical;
    if (rule.match === "contains-or-empty" && (declared === "" || contains)) return rule.canonical;
  }
  throw new Error("the affinity rules have no terminal 'otherwise' rule — the contract is incomplete");
}
