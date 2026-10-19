# 04 — Open questions

Undecided. Each one names the choice, the options, and what it costs. Nothing
here is settled; do not build on an answer that has not been recorded.

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

## 4. Is there a shared schema DSL?

Today only the **dialect knowledge** is shared; each project owns its schema.
The bigger prize is one schema definition that renders DDL for every engine —
and [sure-factor](https://github.com/ShingWong/sure-factor) already has the
candidate: an engine-neutral `SchemaInfo` / `TableInfo` / `ColumnInfo` model,
plus DDL-text introspection with no live connection.

Cost: sure-mail's schema is an AssemblyScript string constant and memeng's is
Python. Adopting a shared DSL means both rewrite how they declare their schema —
a far larger change than sharing tables.

**Stage 2, not 0.1.0.** Worth doing only once the dialect tables have proven
themselves in use.

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
