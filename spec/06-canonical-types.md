# 06 — Canonical type axis

The axis answers one question: **what does this column actually store?** It is a
one-way mapping from an engine's own type facts onto a small shared vocabulary.
It is not a translation layer and not a UI contract.

## Two directions, never conflated

| direction | lives in | answers |
|---|---|---|
| generation | `engines.<e>.types.map` | *what should I declare?* logical name → engine DDL |
| introspection | `engines.<e>.types.canonical` | *what did it become?* engine type → axis |

They overlap in vocabulary (`timestamptz` appears in both) and that is exactly why
they are separate fields. A consumer that reads the generation map as if it
described stored types will believe `sqlite.timestamptz -> TEXT` means the engine
normalises timezones. It does not; it means the declaration text is `TEXT`.

## The axis

```
boolean  smallint  integer  bigint  real  double  numeric
text     citext    binary   date    time  timestamp  timestamp_tz
json     uuid
```

Declared once at `typeAxis.canonical`, and every mapping result is checked against
it — a contract that maps to something not on its own axis fails on the first use,
which is the cheapest possible place to discover the disagreement.

## How each engine maps

**sqlite / turso — by AFFINITY.** The declared type is a hint; nothing is
enforced. Measured on 3.51.3, with the rule order that matters (INT before CHAR,
CHAR before BLOB, BLOB before REAL):

| declaration | affinity | axis |
|---|---|---|
| `INT`, `INTEGER`, `BIGINT`, `POINT` | INTEGER | `integer` |
| `VARCHAR(40)`, `TEXT`, `CLOB` | TEXT | `text` |
| `REAL`, `DOUBLE PRECISION` | REAL | `real` |
| `BLOB`, *empty* | BLOB | `binary` |
| `BOOLEAN`, `DATETIME`, `NUMERIC` | NUMERIC | `numeric` |

**Postgres — by `udt_name`.** The type is real, and the internal name is the
stable one (`varchar`, not `character varying`). Measured across 21 types on
16.15; `int4 → integer`, `bpchar → text`, `timestamptz → timestamp_tz`,
`jsonb → json`, `bytea → binary`.

## Decision records

**CITEXT is not text.** `citext` maps to `citext`, deliberately diverging from the
habit of treating it as a text variant. Case-insensitivity is a semantic property
the consumer chose the type for; collapsing it would delete the reason the column
exists, and no consumer could detect the loss from the axis.

**sqlite's `BOOLEAN` is `numeric`, not `boolean`.** Not a mapper limitation: the
engine enforces nothing, so answering `boolean` would assert a constraint that
does not exist. The same applies to `DATETIME` → `numeric` rather than
`timestamp`.

**Value shape is not type.** Measured: a `'1'` in a `BOOLEAN` column reports
`typeof` **integer**, and a date string in a `DATETIME` column stays **text** —
both are NUMERIC affinity and neither is enforcement. The axis describes the
column, not a particular value; the value-shape traps for timestamps, booleans and
jsonb are recorded in [02](02-engine-matrix.md) and are a separate concern.

**Absence refuses.** A type the tables do not describe is an error, never `other`
and never a best guess. `inet`, `interval`, `tsvector`, `money` and `xml` are
unmapped on Postgres today: a consumer that meets one must decide, and the mapper
makes that decision explicit instead of hiding it behind a category.

## What the axis does not do

- It does not say what a UI should render. That is the consumer's mapping.
- It does not promise storage fidelity — `text` on sqlite and `text` on Postgres
  are the same axis entry, not a guarantee about collation, length or encoding.
- It does not cover length or precision. Those are carried raw by introspection
  (`maxLength`, and the declared type text) and are the consumer's to interpret.
