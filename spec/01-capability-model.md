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
| `clock` | what the engine's current timestamp is — and what it evaluates *to* |
| `types` | how a declared column type materialises, and whether that is enforced |
| `serverInfo` | the statement that reports the server version, if any |
| `identifierQuote` | the quote character a renderer may use |
| `fts.storage` | how the search index is materialised |
| `fts.sync` | who keeps the index current — the core, or the engine |
| `fts.match` | how a match expression is written |
| `fts.semantics` | what the search *means* (tokenizer or text-search config) |
| `fts.ranking` | how results are ordered, if at all |

### Engine facts and binding facts are different

Two of the things a renderer needs are **not** properties of the engine:

| binding fact | why it is not an engine fact |
|---|---|
| `params` — the placeholder style | SQLite's engine accepts `?`, `?NNN`, `:name`, `@name` and `$name`; `node:sqlite` binds **positionally**, so only `?` works through it. Measured: `$1` and `:name` fail there with *column index out of range*. |
| `result` — the affected-row / insert-id envelope | Both SQLite-family bindings report `changes`; `pg` reports `rowCount`. Same engine capability, two driver shapes. |

So they live in a top-level **`bindings`** section, keyed by driver, each naming
its engine. Declaring them per engine would be a category error — and it is the
kind that looks right until a second driver for the same engine appears.

Everything else in the table is an engine fact and lives under `engines.<name>`.

### What changes the shape of what the core emits

Three entries are not value substitutions:

- **`fts.sync`** — where the engine maintains its own index, the core emits
  *fewer* statements; the sync pair is deleted rather than translated.
- **`tx.txOwnership`** — `driver-managed` means the core emits **no** transaction
  statements at all, and the `tx` capabilities describe the driver's frame
  instead of the core's.
- **`params` / `result`** — a binding fact, so it is the *host's* frame that
  decides, and the core renders against the binding it was told about rather
  than against the engine.

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
4. A **path** that does not resolve → **error**, never a falsey value.

Points 1–3 are the same rule at the contract's other edge. A fact that is absent
must refuse to be guessed — and so must the *path* to it. `undefined` falling
through to `false` is not merely imprecise, it **reads as a decision**: "this
binding has no `affectedField`", inviting a renderer to pick a default envelope.
So a resolver must **throw** on an unresolved path, and an unresolved `{token}`
must fail its case rather than survive into the SQL as literal text.

This was measured, twice. `{types.timestamptz}` (flat; the real path is
`types.map.timestamptz`) reached the engine as literal SQL text and was refused
for an unrelated reason; a typo'd `requires.path` merely skipped the case, which
is indistinguishable from an engine that genuinely lacks the capability. Both now
fail. `npm run verify:resolver` proves the resolver refuses — three negatives and
three controls — and any implementation that writes its own resolver owes the
same proof.

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
