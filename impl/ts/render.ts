// sure-store — reference renderer (TypeScript).
//
// Pure functions over an EngineContract. Nothing here reads a file or opens a
// database: the contract is passed in, so this module is testable and the
// loader is a separate concern (see load.ts).
//
// Every string this module produces is pinned by verification/fixtures/, and
// the values it reads come from contracts/engines.json, which was measured
// against live engines. Do not add a dialect fact here — add it to the table.

export interface FtsMatch {
  param: "quoted-phrases" | "plain-text";
  predicate: string;
  searchFrom: string;
}

export interface EngineFts {
  storage: string;
  ddl: string;
  indexDdl?: string;
  defaultConfig?: string;
  configs?: string[];
  sync: "core" | "engine" | "triggers";
  triggers?: string[];
  match: FtsMatch;
  semantics: string;
  prefixSearch?: boolean;
  ranking: string | null;
  requires?: string[];
  traps?: string[];
}

export interface EngineContract {
  kind: string;
  fileFormat: string | null;
  conformance: string;
  network?: boolean;
  identity: { strategy: string; ddl: string; autoAssigns: boolean };
  schemaVersion: { strategy: string; table?: string; read: string; write: string };
  columnProbe: { strategy: string; sql: string };
  fts: EngineFts;
}

export type EngineMap = Record<string, EngineContract>;

/** Fail closed: an engine the tables do not describe is an error, never a guess. */
export function getEngine(engines: EngineMap, name: string): EngineContract {
  const found = engines[name];
  if (!found) {
    throw new Error(
      `sure-store: unknown engine '${name}' — refusing to guess a dialect. ` +
        `Known: ${Object.keys(engines).sort().join(", ")}`,
    );
  }
  return found;
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? vars[key] : whole,
  );
}

/**
 * The match-parameter value, built from the terms the core hands over.
 *
 * The core splits on whitespace and strips quotes, so each term is a single
 * token and quoting one cannot create a phrase. `plain-text` exists because a
 * hand-built tsquery throws on a term carrying tsquery metacharacters —
 * measured; `plainto_tsquery` takes the terms as plain text instead.
 */
export function renderMatchParam(engine: EngineContract, terms: string[]): string {
  const kind = engine.fts.match.param;
  if (kind === "quoted-phrases") {
    return terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" ");
  }
  if (kind === "plain-text") {
    return terms.join(" ");
  }
  throw new Error(`sure-store: unknown match param kind '${kind}'`);
}

export interface FtsDdlOptions {
  name: string;
  table: string;
  cols: string[];
  config?: string;
}

/** The statements that materialise the search index (1 or 2, per engine). */
export function renderFtsDdl(engine: EngineContract, opts: FtsDdlOptions): string[] {
  const vars: Record<string, string> = {
    name: opts.name,
    table: opts.table,
    cols: opts.cols.join(", "),
    config: opts.config ?? engine.fts.defaultConfig ?? "",
    expr: opts.cols.map((c) => `coalesce(${c},'')`).join(" || ' ' || "),
  };
  const statements = [substitute(engine.fts.ddl, vars)];
  if (engine.fts.indexDdl) statements.push(substitute(engine.fts.indexDdl, vars));
  return statements;
}

/**
 * The statements that keep the index current — `[]` when the engine maintains
 * its own index, which is not a translation but a deletion: the core emits
 * fewer statements on those engines.
 */
export function ftsSyncStatements(
  engine: EngineContract,
  opts: { name: string; table: string; cols: string[]; idPredicate: string },
): string[] {
  if (engine.fts.sync === "engine" || engine.fts.sync === "triggers") return [];
  const vars: Record<string, string> = {
    name: opts.name,
    table: opts.table,
    cols: opts.cols.join(", "),
    idPredicate: opts.idPredicate,
  };
  return [
    substitute(
      `DELETE FROM {name} WHERE rowid IN (SELECT rowid FROM {table} WHERE {idPredicate})`,
      vars,
    ),
    substitute(
      `INSERT INTO {name}(rowid, {cols}) SELECT rowid, {cols} FROM {table} WHERE {idPredicate}`,
      vars,
    ),
  ];
}

/**
 * The trigger DDL that maintains the index when the SCHEMA owns upkeep.
 *
 * This is the correct shape for an external-content fts5 table: removal needs
 * the documented 'delete' command carrying the OLD column values, which only a
 * trigger has. Hand-maintained sync is invalid for removal — see the engine's
 * `fts.traps`.
 */
export function renderFtsTriggers(
  engine: EngineContract,
  opts: { name: string; table: string; cols: string[] },
): string[] {
  if (!engine.fts.triggers) return [];
  const vars: Record<string, string> = {
    name: opts.name,
    table: opts.table,
    cols: opts.cols.join(", "),
    newCols: ["new.rowid", ...opts.cols.map((c) => `new.${c}`)].join(", "),
    oldCols: ["old.rowid", ...opts.cols.map((c) => `old.${c}`)].join(", "),
    changedGuard: opts.cols.map((c) => `old.${c} IS NOT new.${c}`).join(" OR "),
  };
  return engine.fts.triggers.map((t) => substitute(t, vars));
}

export interface SearchOptions {
  table: string;
  name: string;
  cols: string[];
  select: string;
  orderBy: string;
  terms: string[];
  limit: number;
  config?: string;
}

/** The search statement plus the parameters it binds, in order. */
export function renderSearch(
  engine: EngineContract,
  opts: SearchOptions,
): { sql: string; params: (string | number)[] } {
  const vars: Record<string, string> = {
    name: opts.name,
    table: opts.table,
    cols: opts.cols.join(", "),
    config: opts.config ?? engine.fts.defaultConfig ?? "",
  };
  const sql =
    `SELECT ${opts.select} FROM ${substitute(engine.fts.match.searchFrom, vars)} ` +
    `WHERE ${substitute(engine.fts.match.predicate, vars)} ` +
    `ORDER BY ${opts.orderBy} DESC LIMIT ?`;
  return { sql, params: [renderMatchParam(engine, opts.terms), opts.limit] };
}
