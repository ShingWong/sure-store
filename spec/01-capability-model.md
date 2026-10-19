# 01 — Capability model

An engine is described by **what it can do**, not by its name. Engine names
appear in `contracts/engines.json` only as *presets*: `engine: "turso"` expands
to a capability set. No renderer branches on a vendor string.

## Why capability-shaped

Three engines are in scope and they differ along the axes below (measured — see
[02](02-engine-matrix.md)). A renderer that switches on the engine name would
need editing for every new engine, and would carry vendor knowledge it should
not have. A renderer that reads capabilities needs editing only when a genuinely
*new kind of capability* appears.

## The dimensions

| dimension | question it answers |
|---|---|
| `identity` | who assigns a primary key — the engine, or the caller? |
| `schemaVersion` | where the schema version lives, and how it is read and written |
| `columnProbe` | how to ask whether a table already has a column |
| `tx.*` | how a transaction is opened, and **who owns it** |
| `dml` | which post-write and post-conflict forms exist (`RETURNING`, `ON CONFLICT`) |
| `indexKinds` | which indexer types the engine can materialise |
| `fts.storage` | how the search index is materialised |
| `fts.sync` | who keeps the index current — the core, or the engine |
| `fts.match` | how a match expression is written |
| `fts.semantics` | what the search *means* (tokenizer or text-search config) |
| `fts.ranking` | how results are ordered, if at all |

Two of these change the **shape** of what the core emits, not merely the text:

- **`fts.sync`** — where the engine maintains its own index, the core emits
  *fewer* statements; the sync pair is deleted rather than translated.
- **`tx.txOwnership`** — `driver-managed` means the core emits **no** transaction
  statements at all, and the `tx` capabilities describe the driver's frame
  instead of the core's. This is the axis carrying the behavioural weight, the
  way `fts.sync` carries it for search.

Everything else is a value substitution.

### A trap is not a capability

`traps[]` records how to get a declared capability *wrong*. The capability list
records what is *possible*. Conflating them — refusing a capability because its
misuse is hazardous — refuses working code, and it is the mistake this model has
already made once: `caller-issued` on Postgres is hazardous without connection
binding and **measured to work with it**, so it is declared with the hazard
beside it rather than prohibited. See [02](02-engine-matrix.md) § Transactions. where the engine maintains its own index the core emits *fewer*
statements, and the sync statements are deleted rather than translated.

## The store port

This spec does not define the call surface — each project already has one. In
sure-mail it is the `store.*` effect port:

```
core ──store.exec {store, sql, params}──▶ host port ──▶ engine
     ◀──store.result {rows, insertId, changes} or {error}
```

That is the L3 boundary, and it already exists. This repository supplies the
**declaration** half — the equivalent of ODBC's `SQLGetInfo` — so the core can
render the right SQL and refuse when it cannot.

## Fail-closed

1. An engine absent from the tables → **error**.
2. An engine present but missing a capability the core needs → **error**.
3. A capability combination the tables do not describe → **error**.

Never a default dialect, never a silent fallback. A wrong-but-plausible
statement is harder to find than a refusal.

## Declaring an engine

A host declares the engine once, at initialisation. In sure-mail that is
`sm_init(configJson)`, which already carries configuration:

```json
{ "store": { "engine": "turso" } }
```

Absent → `sqlite` → byte-identical SQL to today. That is what keeps this
non-breaking for existing hosts.
