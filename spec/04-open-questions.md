# 04 — Open questions

Each question names the choice, the options, and what it costs. **Nothing here
may be built on until its answer is recorded** — and a resolved question keeps
its record here, with what would reopen it, because a decision without its
reasons becomes a rule nobody can revisit.

## 1. Escape vocabulary, or capability-driven rendering?

Both keep the schema in the owning project (so neither moves search logic into a
host). They differ in **who holds the renderer**.

| | how it works | cost |
|---|---|---|
| **escapes** | the core emits portable SQL plus markers (`{fts …}`, `{match …}`); the driver expands them | ODBC-faithful, small driver obligation — but the escape *syntax* is ours, since ODBC's vocabulary covers functions/dates/outer joins and not full-text search |
| **capabilities** | the core reads the declared capability set and renders everything itself; the driver only *executes* | no new syntax to invent, and the driver's job stays trivial — but the core carries the renderer for every engine |

Not exclusive: a declaration is what lets the core **fail closed** either way.
Leaning capability-driven, with the declaration doubling as the refusal
mechanism. **Unresolved.**

## 2. The stemming default — and who may opt out of it

`simple` is the parity config (see [03](03-fts-semantics.md)). The question is
whether a consumer may select `english` at all.

- If **yes**: the divergence must be declared at the point of choice, and the
  consumer owns the consequence that its search matches more than the other
  engines would.
- If **no**: postgres is pinned to `simple` and the question disappears — at the
  cost of a real capability (stemmed search) being unavailable.

Leaning *yes, declared*, because forbidding a capability to preserve a parity
nobody asked for is the wrong trade. **Unresolved.**

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

Read, not assumed (sure-factor @ master, 2026-10-23): `ColumnInfo` carries name,
data type, nullability, `maxLength`, default, `isPrimaryKey` and a per-column
`foreignKey`. There is no composite primary key, no index, no unique constraint,
no check, no collation. Adopting it would not be adopting a schema model; it
would be extending a *form-generation* model into a schema language, and then
calling the extension sure-factor's.

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

**Still open:** whether a `driver-managed` consumer must *also* declare that the
connection is remote, so "server engine" stays visible at the point of choice
rather than merely inferable from `kind: "server"`. Leaning yes.

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
