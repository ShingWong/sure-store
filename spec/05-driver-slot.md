# 05 — The driver slot

FR-2's reply asks: **should sure-store own a driver / bindings implementation
slot now, or later?**

**Answer: later — but reserve the name and write the entry criteria now**, so the
decision is not made under time pressure. Raising it early was the right instinct.

## Why not now

- A driver is a **runtime** object: it opens connections, owns a pool, binds
  parameters, and issues `BEGIN`. Every one of those is deliberately per-consumer
  — FR-1 settled it (`txOwnership` is an axis, not a shared pool type).
- This repository is **dependency-free by design.** Its gates run on a fresh
  clone with no `npm install`, which is what makes them reliable in CI and before
  publish. A driver necessarily depends on its binding (`pg`,
  `@tursodatabase/database`, `node:sqlite`), so putting one here would trade that
  property for a convenience nobody has asked for yet.

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
