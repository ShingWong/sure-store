# 04 — Open questions

Each question names the choice, the options, and what it costs. **Nothing here
may be built on until its answer is recorded** — and a resolved question keeps
its record here, with what would reopen it, because a decision without its
reasons becomes a rule nobody can revisit.

## 1. Escape vocabulary, or capability-driven rendering? — resolved 2026-10-23: **capability-driven**

The renderer reads the declaration; a driver opens a connection, binds parameters
and executes. No escape syntax is invented.

Three things settle it, and the third is new:

- **The declaration already is the mechanism.** `impl/ts` renders every statement
  from `contracts/engines.json`, and fixture-pinned; sure-mail's core carries a
  generated copy of the same facts (`render-fts.mjs` → `fts.generated.ts`).
  Neither path needs a marker for a driver to expand.
- **Escapes buy nothing that is used.** The scenario escapes exist for is SQL
  text that must be executed by something unable to render it. Nothing stores
  statements: sure-mail renders at build time and the host executes finished SQL.
- **Escapes would reverse the driver decision.** [spec/05](05-driver-slot.md)
  created the driver slot on criterion 3 — a driver carries **no dialect facts**.
  An escape expanded *in the driver* is exactly per-engine dialect knowledge in
  the driver. These are not merely alternatives: choosing escapes would undo the
  slot that was just built.

The fail-closed half is unchanged, and now enforced in code: an engine absent
from the tables throws, and so does a text-search config the engine does not
declare (question 2).

**Reopens if** a host must execute SQL text it did not render — a relay or a
service holding stored statements. Then an escape vocabulary is the only way, and
it would need its own fixture first.

## 2. The stemming default — resolved 2026-10-23: **yes, declared — and undeclared refuses**

`simple` stays the default; `english` is available, but only as a **named
choice**:

- the default comes from `fts.defaultConfig` — on postgres `simple`, the parity
  config;
- a non-parity config must be passed explicitly and must appear in
  `fts.configs`; anything else refuses (`ftsConfig`), because rendering
  `to_tsvector('klingon', …)` is a guess rather than a dialect;
- the consequence is recorded beside the choice, where the consumer will read
  it: postgres's `fts.traps` says `to_tsvector('english', …)` stems and matches
  more than `unicode61` would.

Refusing `english` outright was the alternative, and it is the mistake this
repository has already made once: a hazard is not a capability
([01](01-capability-model.md), `caller-issued` on postgres). Silent divergence
was the other alternative, and it is worse — the difference has to be visible at
the point of choice, never a default ([03](03-fts-semantics.md)). A capability
that is named, declared, warned about and refused when undeclared is neither of
those mistakes.

Pinned by `render.json → ftsConfig`: the default is the parity config on every
engine that declares one, `english` renders `plainto_tsquery('english', ?)`, and
an undeclared config refuses.

## 3. Prefix search is not portable

sqlite and postgres support `term*`; Turso does not. No consumer uses it today.

Options: declare it as a capability and let a consumer lose portability
deliberately, or leave it out of the contract entirely until someone needs it.
Leaning the latter — an unused capability is speculative, and this repo's whole
discipline is to record what was measured, not what might be wanted.
**Unresolved, deliberately deferred.**

## 4. Is there a shared schema DSL? — resolved 2026-10-23: **no**, with a trigger

**Answer: the contract keeps carrying dialect facts; no schema DSL enters it.**
Each consumer composes its own schema text from those facts. The question
reopens on a named trigger, not on interest.

### The shortcut was measured and refused

The attractive middle is *"the introspection record is already neutral and
fixture-pinned, so render DDL from it"*. `verification/live/ddl-from-records.mjs`
creates two tables whose **column records are identical** and whose DDL is not:

```
CREATE TABLE plain (id INTEGER PRIMARY KEY, email TEXT NOT NULL, price NUMERIC DEFAULT 0)
CREATE TABLE rich  (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE,
                    price NUMERIC DEFAULT 0 CHECK (price >= 0))
CREATE INDEX rich_lower_email ON rich (lower(email))

columns: IDENTICAL — UNIQUE and CHECK leave no trace
record sections: tables, columns, primaryKeys, foreignKeys
```

`UNIQUE`, `CHECK` and every index live outside the record model, so a renderer
fed a record drops them **without noticing**. That is the failure this repository
exists to prevent: a plausible rendering that is quietly lossy. Making the record
lossless means extending it into a declaration format — a DSL by another name —
which lands back on the cost below.

### The candidate model is thinner than "SchemaInfo" sounds

Read, not assumed (sure-factor @ 0.5.2, 2026-10-23): `ColumnInfo` carries name,
data type, nullability, `maxLength`, default, `isPrimaryKey`, a per-column
`foreignKey`, and — since 0.5.1 — a free-text `comment` and `enumValues` parsed
from `CHECK (column IN (…))`. There is still no composite primary key, no index,
no unique constraint, no general check model (an `IN` list is an enum a form can
render, not a constraint the engine enforces), and no collation. Adopting it
would not be adopting a schema model; it would be extending a *form-generation*
model into a schema language, and then calling the extension sure-factor's.

The two additions are the reason the answer has not moved: they are facts a
**form** needs — a picker and a help line — not facts the engine enforces. That
is the boundary this contract draws, and it is worth naming, because the
alternative reading ("the model is growing, so it may become a schema model") is
the one that would quietly reverse the decision.

The cost is unchanged and large: sure-mail's schema is one AssemblyScript string
constant, deliberately sqlite-shaped (rowid identity, FTS5 triggers), and
memeng's is Python. Both would rewrite how they declare their schema.

### The prize is not currently being lost

The motivation was "one schema definition that renders DDL for every engine".
Measured, nobody has that need:

- sure-mail's `schema.ts` is 146 lines with **no engine branch** — sqlite only —
  and five hand-written `CREATE INDEX` statements. The core has **zero**
  postgres references and consumes no `identity.ddl` / `types.map` fragment; the
  only contract-derived DDL it ships is the FTS block.
- sure-factor consumes the contract for introspection and types, not for DDL.
- memeng declares its own schema in Python.

So multi-engine schema rendering is a hypothetical, and the fragments that do
exist (`identity.ddl`, `types.map`, `identifierQuote`) are question 1's escape
approach applied to DDL — available to any consumer, used by none yet.

### What reopens it

Either, arriving as a **fixture** rather than a wish:

1. **two consumers need one schema rendered for two engines** — the first real
   multi-engine schema, at which point the DSL has a consumer and a fixture; or
2. **a consumer needs its schema validated against the tables at build time**
   and cannot keep its own renderer — the fail-closed argument, which is about
   validity rather than about sharing text.

### Consequence for stage 2

5.2 ("per-engine DDL rendering from the tables") is re-scoped by this decision;
it is not a DSL task. The measured gap is narrower: the tables declare
`indexKinds` (which index kinds each engine can materialise — `btree`,
`partial`, `expression`, then `fts` or `gin`) but no **index or constraint DDL**, while sure-mail
hand-writes five `CREATE INDEX` statements. If a second dialect ever needs them,
they become contract entries with fixtures, the same shape as every other fact
here.

## 5. Postgres is a *server* — but the axis is narrower than yes/no

sure-mail is local-first and air-gap by default. A network engine in the store
port is a different shape of thing: credentials in a connection string, TLS, a
host that can be remote — the territory D17 ruled out when it rejected a hosted
connect-proxy that "puts the server in the credential path".

**The yes/no framing is wrong, though, and FR-1 is right about why.** The
dimension that actually bites is narrower: **who issues `BEGIN`?**

| `txOwnership` | meaning |
|---|---|
| `caller-issued` | the core renders `BEGIN`/`COMMIT`/`ROLLBACK` as statements. Local-first consumers — sure-mail, memeng. |
| `driver-managed` | the host owns the connection and therefore the transaction; the core emits **no** transaction statements at all, and the `tx` capabilities describe the driver's frame. A management service on a server DB is this by necessity. |

Splitting the axis turns #5 from *"is postgres allowed?"* into *"resolved per
consumer"*, which lets the postgres entry stand without answering the
credential-path question globally. Both engines that can host a transaction are
declared accordingly in `contracts/engines.json`.

**Resolved 2026-10-23: no — `kind` is the declaration, and "remote" is not a contract fact.**

The concern was that a server engine should stay visible at the point of choice
rather than merely inferable. It is already visible: every engine declares
`kind: "embedded" | "server"`, and that is the fact a consumer chooses on. The
verification suite asserts every engine declares it, so a new entry cannot be
silent.

What a second flag would claim is something the contract cannot know. Whether a
connection is remote is a property of the *connection*: Postgres over a unix
socket is local, and a sqlite file on a network share is not. It is also the same
class of fact as the database name and the user — management facts, which
[spec/05](05-driver-slot.md) puts **above** the driver rather than inside the
contract. A `remote: true` entry would make the tables assert a deployment detail
and invite a consumer to trust a flag instead of its own configuration.

`txOwnership` is orthogonal and stays so: a driver-managed consumer of an
*embedded* engine is legitimate (a host owning its own connection), which is
exactly why remoteness cannot be inferred from `txOwnership` either.

**Related, and the reason the axis exists at all:** a transaction belongs to the
*connection*, not the pool. A transaction-local query issued on a pool handle
runs autocommit while the rest of the transaction runs inside it. That was felt
in practice as a *missing `FOR UPDATE` lock*, not as leaked SQL — which is
exactly the class of bug a `txOwnership` declaration makes visible.
`verification/fixtures/tx.json` pins it.

## 6. Ranking

Declared in the tables (`fts_score`, `ts_rank`, none) but unused by every
consumer. Left in as a measured value so nobody invents one; not a commitment
that results will rank comparably across engines. **Not a priority.**
