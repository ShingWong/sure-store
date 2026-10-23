# Guide — consuming, porting, and adding to the contract

This repository ships three things, and they are separable:

| | what it is | who needs it |
|---|---|---|
| `contracts/engines.json` | the facts: what each engine stores and accepts, and what each binding binds | every consumer, every language |
| `impl/ts` | a **reference** renderer: pure functions over the contract, no I/O | TypeScript consumers, and anyone who wants a worked example |
| `verification/fixtures/` | the **contract itself**: cases with inputs and machine-readable checks | every renderer and driver, in any language |

> **No engine-specific SQL without a declared capability.** If the tables do not
> say it, a renderer must error rather than guess. That rule is the whole point;
> everything below is how to keep it.

## 1. Reading the contract

```
engines.<engine>           engine facts (sqlite, turso, postgres)
bindings.<binding>         driver facts, each naming its engine
typeAxis.canonical         engine type name -> canonical type
specVersion                the contract version a consumer pins
```

**Engine facts and binding facts are different, and mixing them is a category
error.**
`params` (placeholder style) and `result` (the affected-row / insert-id
envelope) live under `bindings`, because the same engine can be driven by two
bindings that differ — SQLite accepts `?`, `?NNN`, `:name`, `$name`, but
`node:sqlite` binds **positionally**, so only `?` works through it.

Everything is a value. The only structural facts are the ones that change the
*shape* of what is emitted:

| fact | effect |
|---|---|
| `fts.sync: "triggers"` / `"engine"` | with `engine`, the sync statements are **deleted**, not translated |
| `tx.txOwnership: "driver-managed"` | the core emits **no** transaction statements; the driver owns the frame |
| `bindings.<b>.params` | decides how a bound parameter is spelled, at composition time |

A **trap** is not a capability. `traps[]` records how to get a declared capability
wrong; it never means the capability is unavailable. `caller-issued` on Postgres
is hazardous on a pool handle and measured to work on a bound connection — so it
is declared, with the hazard beside it.

## 2. What a port implements

Two independent things. Most projects need only the first.

1. **A renderer** — pure functions from contract + inputs to SQL and parameters.
   `impl/ts` is one; `verification/run-ts.mjs` checks it against
   `fixtures/render.json`, `introspect.json` and `types.json`.
2. **A runner** — executes `fixtures/tx.json` and `fixtures/stmt-shape.json`
   against a real engine. `verification/run-behaviour.mjs` is one, and
   `verification/python/run_fixtures.py` is a second, in another language.

A **driver** (opening connections, binding parameters) is neither: it is a
sibling package, one per binding. See [spec/05](../spec/05-driver-slot.md).

## 3. Porting a renderer

1. Read `contracts/engines.json`. Do not transcribe it into code — read it at
   runtime, or generate from it at build time and fail the build on drift.
2. Implement the statement builders the fixtures call, in the same order.
3. Run the render fixtures. A port is correct when it matches them **exactly**,
   including parameter order.
4. Refuse what you do not implement: an engine absent from the tables, a
   placeholder style you cannot bind (`named`), a text-search config the engine
   does not declare.

Two rules that are easy to get wrong and are pinned by fixtures:

- **Compose placeholders, never rewrite finished SQL.** `?` is also the Postgres
  jsonb existence operator and it appears inside string literals, so a textual
  `?` → `$n` pass turns `detail ? 'key'` into `detail $1 'key'`.
- **Count the placeholders you substitute.** `?` is valid SQL on its own, so a
  missed slot binds the wrong parameter silently.

## 4. Porting

### The runner obligation

A runner is correct when it satisfies `verification/fixtures/`, and not before.
The obligations, from [fixtures/README.md](../verification/fixtures/README.md):

1. **Fresh database per case** — state must not leak between cases.
2. **Check `requires` first**, and report a non-run as **SKIPPED** with a reason.
3. **A skip is a result, not a failure** — "this engine cannot express it" and
   "this engine failed it" are different facts. A suite that reports a skip as a
   pass is as wrong as one that reports it as a failure.
4. **Honour `expects: "reject"`** by asserting the refusal, never by letting the
   error escape and calling the crash a pass.
5. **A path that does not resolve is a failure.** `undefined` must never be read
   as "absent": that turns a typo into a skip, and a skip into green.
6. **Declare what you can reach.** An engine with no driver is a skip with a
   reason, not a pass.

### The worked example

`verification/python/run_fixtures.py` is a full runner in Python — standard
library and `sqlite3`, written from the fixtures README rather than ported from
the JavaScript. It reports the same result for all 20 sqlite-family cases as the
JavaScript runner, which is the useful fact: the format is implementable from its
description, not only from its implementation.

What it deliberately does not do: it ships one driver (sqlite), so turso and
postgres are skipped; and it refuses a `positional-dollar` binding, because
`{ph}` numbering is expressed by the renderer, not by the substitution contract.

## 5. Adding an engine

1. Run the probes in `verification/live/` against it; record the raw output in
   the commit message. **Never write a dialect fact from memory.**
2. Add the entry to `contracts/engines.json` and extend
   `contracts/engines.schema.json` if the shape needs it.
3. Add the fixtures it must satisfy — including the ones it must **refuse**.
4. Only then touch a renderer.

## 6. Adding a language

Read `contracts/engines.json`, satisfy `verification/fixtures/`, ship a runner
that proves it, and say which engines it reaches. Two runners agreeing is
evidence; one runner alone is an implementation.

## 7. Pitfalls this repository has already paid for

Measured, and recorded where they belong — this list is a shortcut to the
reasoning, not a substitute for the spec.

| pitfall | where it bites | recorded in |
|---|---|---|
| `PRAGMA table_info(?)` is a syntax error | sqlite introspection must inline a quoted identifier | [spec/02](../spec/02-engine-matrix.md) |
| `notnull: 0` on an `INTEGER PRIMARY KEY` | `nullable = rawNullable AND NOT isPrimaryKey` | [spec/02](../spec/02-engine-matrix.md) |
| joining Postgres FK catalogs by name | invents column pairs on composite keys; join via `unique_constraint_name` + `position_in_unique_constraint` | [spec/02](../spec/02-engine-matrix.md) |
| `GENERATED ALWAYS AS IDENTITY` | rejects the explicit ids every importer uses; Postgres identity is `BY DEFAULT` | [spec/02](../spec/02-engine-matrix.md) |
| sqlite's declared type is a hint | `BOOLEAN` maps by affinity to `numeric`; `citext` is not `text` | [spec/06](../spec/06-canonical-types.md) |
| `COUNT(*)` is int8 on Postgres | the driver returns a string; compare by value, not by JS type | [spec/02](../spec/02-engine-matrix.md) |
| a direct `DELETE` on an external-content fts5 table | raises "database disk image is malformed" for an unindexed rowid; upkeep is triggers | [spec/03](../spec/03-fts-semantics.md) |
| `from_unixtime` / `now()` | engine-specific; both are declared, neither is assumed | `contracts/engines.json` |
