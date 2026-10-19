# 02 — Engine matrix (normative)

**Every value below was measured against a live engine.** The probe that
produced it is named; re-run the probe before changing a value. If a fact is not
here, it is not known — do not fill the gap from memory.

## How these were measured

| engine | how |
|---|---|
| sqlite | sure-mail's `SCHEMA_V4`, extracted **programmatically** from `packages/core/src/store/schema.ts` (not retyped), run statement by statement |
| turso | `@tursodatabase/database` 0.8.3, Node's synchronous `./compat` entry |
| postgres | PostgreSQL 16.15, `psql -v ON_ERROR_STOP=0 -f`, then `-v ON_ERROR_STOP=1` per probe |

Probes live in `verification/live/`.

## The matrix

| dimension | sqlite | turso | postgres |
|---|---|---|---|
| `identity` | rowid alias — `INTEGER PRIMARY KEY` auto-assigns | same | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `schemaVersion` | `PRAGMA user_version`, read and written | same | a table: `_sure_store_meta(k,v)` + upsert |
| `columnProbe` | `pragma_table_info('{t}')` | same | `information_schema.columns` |
| `fts.storage` | `CREATE VIRTUAL TABLE … USING fts5(…, content='{t}', content_rowid='rowid', tokenize='unicode61')` | `CREATE INDEX … ON {t} USING fts ({cols})` | generated `tsvector` column + `GIN` index |
| `fts.sync` | **core** emits 2 statements (delete + insert) | **engine** (none) | **engine** (generated column) |
| `fts.match` | `"a" "b"` (quoted phrases) | `"a" "b"` — **identical** | `a & b` (`to_tsquery`) |
| `fts.semantics` | `tokenize='unicode61'` | engine index | `to_tsvector('simple', …)` by default |
| `fts.ranking` | none used (order by the row's own column) | `fts_score({cols}, ?)` | `ts_rank` |
| `ALTER TABLE … ADD COLUMN` | ✅ | ✅ | ✅ |

## What is portable

The entire non-search schema: table DDL, all indexes, `ALTER TABLE … ADD COLUMN`,
parameterised DML, and `PRIMARY KEY (a, b, c)` composite keys. Measured on all
three. `STRICT`, `WITHOUT ROWID` and `AUTOINCREMENT` are non-issues because the
consumers use none of them.

## Trap 1 — Turso's `fts_match` takes the **columns**, not the index name

```sql
-- works: the first argument is the column list
SELECT id FROM messages WHERE fts_match(subject, body, sender, ?);

-- parses, returns SILENTLY EMPTY
SELECT id FROM messages WHERE fts_match('messages_fts', ?);
```

No error, no rows. Cost one debugging cycle to find.

Two related facts: the FTS index needs `experimental: ["index_method"]` when the
database is opened, and the engine maintains the index itself — a row inserted
with no explicit sync is found immediately, so the external-content sync
statements an fts5 table needs are **deleted**, not translated.

## Trap 2 — Postgres parses `INTEGER PRIMARY KEY` and does **not** auto-assign it

```sql
CREATE TABLE accounts (id INTEGER PRIMARY KEY, address TEXT);   -- accepted
INSERT INTO accounts (address) VALUES ('a@b.c');
-- ERROR: null value in column "id" of relation "accounts"
--        violates not-null constraint
```

The DDL applies cleanly and the schema **looks** portable. A portability check
that stops at *"did the DDL apply?"* reports success and is wrong; the failure
appears only when an insert omits `id`. Postgres needs
`GENERATED ALWAYS AS IDENTITY`.

The same shape of trap: `PRAGMA user_version = 4` is a **syntax error** on
Postgres, and `pragma_table_info` is a **function that does not exist** — both
fail loudly. The identity one is the dangerous one because it does not.

## The whole break list, for a SQLite-shaped schema

Measured against Turso, from a real core schema:

| # | statement | turso |
|---|---|---|
| 1 | `CREATE VIRTUAL TABLE … USING fts5(…)` | `no such module: fts5` |
| 2 | `… FROM x_fts f JOIN x m ON m.rowid = f.rowid WHERE x_fts MATCH ?` | `no such table: x_fts` |
| 3 | `DELETE FROM x_fts WHERE rowid IN (…)` | `no such table` |
| 4 | `INSERT INTO x_fts(rowid, …) SELECT …` | `no such table` |

Four statements, all search. Everything else is portable — and statements 3 and
4 disappear rather than change, because Turso maintains its own index.

Against Postgres, from the same schema, the same four fail *plus* the identity,
version and column-probe dimensions.

## Transactions and DML — measured on all three (FR-1)

The dimensions above are all *syntactic*. Transactions are the first
**behavioural** axis: the SQL is nearly identical and the semantics are not.
Measured per capability, on a fresh connection each time:

| capability | sqlite | turso | postgres |
|---|---|---|---|
| `BEGIN` | ✅ | ✅ | ✅ |
| `BEGIN IMMEDIATE` | ✅ | ✅ | ❌ syntax error |
| `COMMIT` / `ROLLBACK` | ✅ | ✅ | ✅ |
| `SAVEPOINT` / `RELEASE` | ✅ | ✅ | ✅ |
| `SET TRANSACTION ISOLATION LEVEL` | ❌ syntax error | ❌ syntax error | ✅ |
| `SELECT … FOR UPDATE` | ❌ syntax error | ❌ syntax error | ✅ |
| advisory lock (`pg_advisory_lock`) | ❌ no such function | ❌ no such function | ✅ |
| `RETURNING` after INSERT | ✅ | ✅ | ✅ |
| `ON CONFLICT … DO UPDATE` | ✅ | ✅ | ✅ |
| `ON CONFLICT … DO NOTHING` | ✅ | ✅ | ✅ |
| partial unique index (`… WHERE …`) | ✅ | ✅ | ✅ |
| expression index | ✅ | ✅ | ✅ |

**Three of these correct a claim that had been asserted rather than measured**
(FR-1):

1. `RETURNING` is *not* "sqlite only in some bindings" — modern SQLite supports
   it natively (measured on 3.51.3).
2. **A partial unique index is expressible on Turso.** The FR said it could not
   be and had a migration plan resting on that. It can.
3. `BEGIN IMMEDIATE` runs the other way: SQLite and Turso have it, Postgres does
   not.

The axis is also asymmetric in a way one shared list cannot express: SQLite and
Turso distinguish *deferred vs immediate*, while Postgres has *isolation levels,
row locks and advisory locks* instead. So `tx.isolationLevels` is **empty** for
the two embedded engines rather than carrying a shared list. An empty list is the
honest value, and it is what makes a consumer's `SET TRANSACTION` fail closed
instead of appearing to work.

`txOwnership` is the axis that carries the behavioural weight — see
[04](04-open-questions.md) § 5.

**Caller-issued on a server engine requires binding one connection.** Postgres
measures `BEGIN; COMMIT;` and `SELECT … FOR UPDATE` as working caller-issued
(16.15), so `caller-issued` is declared for it — but issuing on a *pool handle*
induces the recorded trap: the transaction-local statement runs autocommit while
the rest of the transaction runs inside it, which surfaces as a **missing lock**
rather than as leaked SQL. The capability is real; the hazard sits beside it.
Refusing the capability because its misuse is hazardous would refuse working
code — see [01](01-capability-model.md) § *A trap is not a capability*.
