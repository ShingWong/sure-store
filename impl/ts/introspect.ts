// Introspection: contract-declared statements, and the normalization that turns
// each engine's raw rows into one generic record.
//
// The engines genuinely differ in shape, and the tables say so rather than hiding
// it: sqlite is per-table with the name inlined (PRAGMA takes no argument),
// Postgres is set-based with a bound schema. What is shared is the RULE, and the
// rule is here:
//
//   nullable = rawNullable AND NOT isPrimaryKey
//
// without which sqlite's `notnull: 0` on an INTEGER PRIMARY KEY would be read as
// "nullable" while Postgres says "NO" for the same column — see spec/02.
//
// This module stays schema-free on purpose: nothing here learns a consumer's
// SchemaInfo. It returns plain records.

import type { EngineContract, IntrospectionQuery } from "./render.ts";

export type IntrospectionSection = "tables" | "columns" | "primaryKeys" | "foreignKeys";

export interface TableRecord {
  schema: string | null;
  name: string;
}

export interface ColumnRecord {
  table: string | null;
  name: string;
  ordinal: number;
  typeName: string | null;
  typeInternal: string | null;
  maxLength: number | null;
  nullable: boolean;
  defaultText: string | null;
  primaryKeyPosition: number | null;
}

export interface PrimaryKeyRecord {
  table: string;
  columns: string[];
}

export interface ForeignKeyRecord {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
}

type Row = Record<string, unknown>;

/** The declared statements for a section, or a refusal. */
function sectionSpec(engine: EngineContract, section: IntrospectionSection): IntrospectionQuery {
  const spec = engine.introspection;
  if (!spec) {
    throw new Error(
      "introspection is not declared for this engine — refusing rather than guessing what it would say",
    );
  }
  const q = spec[section];
  if (!q || typeof (q as IntrospectionQuery).sql !== "string") {
    const derived = q && "source" in q ? ` (derived from ${String(q.source)})` : "";
    throw new Error(`${section} has no statement on this engine${derived}`);
  }
  return q as IntrospectionQuery;
}

function quoteIdent(engine: EngineContract, name: string): string {
  const q = String(engine.identifierQuote ?? '"');
  return q + name.split(q).join(q + q) + q;
}

/**
 * Render one introspection statement for an engine.
 *
 * `tableRef: "inline-quoted"` is a safety obligation: the name cannot be bound,
 * so it is quoted and its internal quote characters doubled. Anything the engine
 * binds comes back as `params`, in the order the contract declares.
 */
export function renderIntrospection(
  engine: EngineContract,
  section: IntrospectionSection,
  opts: { table?: string; schema?: string } = {},
): { sql: string; params: string[] } {
  const q = sectionSpec(engine, section);
  let sql = String(q.sql);
  const params: string[] = [];

  if (q.tableRef === "inline-quoted") {
    if (!opts.table) throw new Error(`${section} needs a table name on this engine`);
    sql = sql.split("{table}").join(quoteIdent(engine, opts.table));
    if (sql.includes("{table}")) throw new Error(`${section} still contains {table} after substitution`);
  }

  const names = engine.introspection?.params ?? [];
  for (const name of names) {
    const value = (opts as Record<string, string | undefined>)[name];
    if (value === undefined) throw new Error(`${section} needs a "${name}" argument`);
    params.push(value);
  }
  return { sql, params };
}

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function fields(engine: EngineContract, section: IntrospectionSection): Record<string, string | null> {
  return sectionSpec(engine, section).fields ?? {};
}

function pick(row: Row, field: string | null | undefined): unknown {
  return field ? row[field] : undefined;
}

export function normalizeTables(engine: EngineContract, rows: Row[]): TableRecord[] {
  const f = fields(engine, "tables");
  return rows.map((r) => ({ schema: text(pick(r, f.schema)), name: String(pick(r, f.name)) }));
}

export function normalizeColumns(
  engine: EngineContract,
  rows: Row[],
  opts: { table?: string } = {},
): ColumnRecord[] {
  const q = sectionSpec(engine, "columns");
  const f = (q.fields ?? {}) as Record<string, string | null>;
  const nullability = q.nullability!;
  return rows.map((r) => ({
    // A per-table result (sqlite's PRAGMA) does not repeat the table name, so the
    // caller supplies it; a set-based result (Postgres) carries its own.
    table: pick(r, f.table) == null ? (opts.table ?? null) : String(pick(r, f.table)),
    name: String(pick(r, f.name)),
    ordinal: Number(pick(r, f.ordinal)),
    typeName: text(pick(r, f.typeName)),
    typeInternal: text(pick(r, f.typeInternal)),
    maxLength: num(pick(r, f.maxLength)),
    // Raw, before the primary-key correction; applyNullability does that, because
    // on Postgres the key is not in this result at all.
    nullable: r[nullability.field] === nullability.nullableValue,
    defaultText: text(pick(r, f.defaultText)),
    primaryKeyPosition: num(pick(r, q.primaryKeyPosition)),
  }));
}

/**
 * Primary keys, from the declared statement or derived from the columns result.
 *
 * Both shapes exist: sqlite marks the key on each column (`pk` position), Postgres
 * reports it as its own rows. Deriving the same record from either keeps a
 * consumer from having to care which.
 */
export function normalizePrimaryKeys(
  engine: EngineContract,
  rows: Row[],
  columns?: ColumnRecord[],
): PrimaryKeyRecord[] {
  const spec = engine.introspection?.primaryKeys;

  if (spec && "source" in spec && spec.source === "columns") {
    if (!columns) throw new Error("primary keys are derived from the columns result — pass it");
    const byTable = new Map<string, { column: string; position: number }[]>();
    for (const c of columns) {
      if (!c.primaryKeyPosition || c.primaryKeyPosition <= 0) continue;
      const key = c.table ?? "";
      const list = byTable.get(key) ?? [];
      list.push({ column: c.name, position: c.primaryKeyPosition });
      byTable.set(key, list);
    }
    return [...byTable.entries()]
      .map(([table, list]) => ({
        table,
        columns: list.sort((a, b) => a.position - b.position).map((x) => x.column),
      }))
      .sort((a, b) => a.table.localeCompare(b.table));
  }

  const f = fields(engine, "primaryKeys");
  const grouped = new Map<string, { column: string; position: number }[]>();
  for (const r of rows) {
    const table = String(pick(r, f.table));
    const list = grouped.get(table) ?? [];
    list.push({ column: String(pick(r, f.column)), position: Number(pick(r, f.ordinal)) });
    grouped.set(table, list);
  }
  return [...grouped.entries()]
    .map(([table, list]) => ({
      table,
      columns: list.sort((a, b) => a.position - b.position).map((x) => x.column),
    }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * Foreign keys, grouped by constraint.
 *
 * A table may have many keys and a key may have many columns, so the row is not
 * the record: rows are grouped by the engine's constraint key and ordered on both
 * sides. The naive Postgres join returns cross-product pairs — see spec/02.
 */
export function normalizeForeignKeys(
  engine: EngineContract,
  rows: Row[],
  opts: { table?: string } = {},
): ForeignKeyRecord[] {
  const q = sectionSpec(engine, "foreignKeys");
  const f = (q.fields ?? {}) as Record<string, string | null>;
  const groups = new Map<string, { row: Row; position: number }[]>();

  for (const r of rows) {
    const owning = pick(r, f.table) == null ? (opts.table ?? "") : String(pick(r, f.table));
    const key = `${owning}\u0000${String(pick(r, q.constraintKey))}`;
    const list = groups.get(key) ?? [];
    list.push({ row: r, position: Number(pick(r, f.ordinal)) });
    groups.set(key, list);
  }

  return [...groups.values()].map((list) => {
    const ordered = list.sort((a, b) => a.position - b.position).map((x) => x.row);
    const first = ordered[0];
    return {
      table: pick(first, f.table) == null ? (opts.table ?? "") : String(pick(first, f.table)),
      columns: ordered.map((r) => String(pick(r, f.column))),
      refTable: String(pick(first, f.refTable)),
      refColumns: ordered.map((r) => String(pick(r, f.refColumn))),
      onDelete: text(pick(first, f.onDelete)),
      onUpdate: text(pick(first, f.onUpdate)),
    };
  });
}

/**
 * Apply the shared nullability rule.
 *
 * `nullable = rawNullable AND NOT isPrimaryKey` — idempotent on an engine that
 * already reports a primary key as NOT NULL, and the only thing that makes the two
 * engines agree about an INTEGER PRIMARY KEY.
 */
export function applyNullability(
  columns: ColumnRecord[],
  primaryKeys: PrimaryKeyRecord[],
): ColumnRecord[] {
  const isKey = new Set<string>();
  for (const k of primaryKeys) for (const c of k.columns) isKey.add(`${k.table}\u0000${c}`);

  return columns.map((c) => ({
    ...c,
    nullable:
      c.nullable &&
      !(c.primaryKeyPosition !== null && c.primaryKeyPosition > 0) &&
      !isKey.has(`${c.table ?? ""}\u0000${c.name}`),
  }));
}
