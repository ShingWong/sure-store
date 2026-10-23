# 05 — The driver slot

FR-2's reply asks: **should sure-store own a driver / bindings implementation
slot now, or later?**

**Answer: later — but reserve the name and write the entry criteria now**, so the
decision is not made under time pressure. Raising it early was the right instinct.

## Why not now

- A driver is a **runtime** object: it opens connections, owns a pool, binds
  parameters, and issues `BEGIN`. Every one of those is deliberately per-consumer
  — FR-1 settled it (`txOwnership` is an axis, not a shared pool type).
- This repository is **dependency-free at runtime, and its gates install
  nothing.** Every measured fact is verified on a fresh clone under plain node,
  which is what makes the gates reliable in CI and before publish. A driver
  necessarily depends on its binding (`pg`, `@tursodatabase/database`,
  `node:sqlite`), so putting one here would trade that property for a convenience
  nobody has asked for yet.
  Packaging is the one exception and is not a gate: `exports` must point at
  compiled output, because a compiled consumer cannot load raw TypeScript, so a
  build step installs a compiler as a **dev** dependency. No measured value
  depends on it.

## What is reserved

A **sibling package**, named per **binding** — not per engine:

```
@shing.wong/sure-store-driver-<binding>
    …-driver-node-sqlite
    …-driver-pg
    …-driver-turso
```

Per binding because that is what a driver *is*: the `bindings` vocabulary FR-2
established settles the naming FR-1 could not. `-pg` names the binding, not the
engine — a second Postgres binding would be `-postgresjs`, and would be a second
driver even though it is the same engine.

**`impl/ts` is not that slot and must not become it.** It is a *reference
renderer*: pure functions over the contract, no I/O, no dependencies. It exists
so there is a worked example of what the fixtures demand, and so TypeScript
consumers get the rendering for free.

## Entry criteria

The slot is created when **any** of these holds:

1. a second consumer needs the same driver behaviour — it stops being
   per-consumer by nature;
2. a second binding exists for an engine already declared — which is when the
   per-binding naming earns its keep;
3. the driver can be expressed **entirely from the contract** — no new facts, no
   engine knowledge of its own.

Criterion 3 is the load-bearing one. A driver written from the tables is a
*rendering* of the contract. A driver that needs facts the contract does not
carry is evidence that the **contract is incomplete** — and the fix belongs here
first, not in the driver.

It has a second edge, found by the first consumer to audit itself against it:
**consumer defaults are facts too.** A kernel that emits every statement-shape
fact from the tables — `bindings.pg.params`, `dml.returning`, `identifierQuote`,
`txOwnership`, the result envelope via `bindings.<b>.result.affectedField` — and
still hard-codes `database: "positronic"` or `user: "positronic_app"` has not met
the criterion. Those are management facts, not binding facts: they belong in the
consumer layer *above* the driver. "Fact-free" means free of every fact, not
merely of engine facts, and stripping them is a prerequisite for the split rather
than a follow-up to it.

## What a consumer does meanwhile

Its driver stays in its own repo, under its own licence, depending on
`@shing.wong/sure-store` — one direction only. The contract remains the source of
truth; the consumer remains a consumer, not a hard-coded renderer.

## Created — 2026-10-23

The slot is real: `drivers/node-sqlite` publishes as
`@shing.wong/sure-store-driver-node-sqlite` (MIT).

### Which entry criterion, and why

**Criterion 3 — expressed entirely from the contract.** Criterion 1 is *not*
met: sure-factor is unblocked by 0.1.0 but does not depend on the package yet
(its `package.json` was checked on 2026-10-23), and pai-core has zero
references. Criterion 2 is *not* met: no declared engine has a second binding.

Criterion 3 holds in its checkable form, not as an assertion. The driver reads
its own entry out of `bindings` and refuses to open when the contract stops
describing it (`assertBindingSupported`): a binding that moved to
`positional-dollar`, or renamed `changes`, is a contract/driver disagreement,
and the driver does not get to guess which side is wrong. Every dialect fact it
relies on is the contract's. What the driver itself carries is its binding
library's API — `DatabaseSync`'s methods — and that is what a driver *is*, not an
engine fact leaking into it.

The second edge, **"consumer defaults are facts too"**, is met by having none:
the path is the caller's argument, `:memory:` is a documented test default, and
no database name, user, pool size or timeout is baked in.

### Evidence

`verification/run-behaviour.mjs --driver <binding>=<path>` runs that binding's
cases through a driver named on the command line, and keeps the adapter logic
itself — "single statements go through `run()` so the envelope is observable" is
a rule about how fixtures are verified, not a fact about any binding. The runner
still imports no driver: the dependency stays consumer → driver → contract.

The driver's own test asserts the label names the driver, so a silent fallback
to the built-in adapter fails rather than passing as conformance.

### Deliberately absent

- no pool and no `BEGIN` policy — `txOwnership` stays an axis of the caller;
- no normalised result envelope — `changes` / `lastInsertRowid` are reported as
  bound, which is what binding-scoped fixtures exist to assert;
- no migration or DDL — that is stage 2, whose scope Q4 settled (spec/04 §4):
  contract fragments, not a schema DSL;

### First consumer

**None yet.** The driver is scaffolded ahead of its trigger, and this record
says so rather than dressing it up. The first expected consumer is sure-factor's
Phase 0 wiring, which 0.1.0 unblocked.

### Where it lives

In this repository as a package, because the fixtures are the contract and a
conformance suite that lives beside them cannot drift from them. The *packages*
stay separate and the direction stays one way: `@shing.wong/sure-store` still has
no runtime dependency, and the `gate` job still installs nothing — the `driver`
job installs, as `package` and `behaviour` already do.
