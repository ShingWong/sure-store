# 03 — FTS semantics

## The limit, stated plainly

**You can abstract syntax. You cannot abstract semantics.**

The match *syntax* is renderable from the tables: `"a" "b"` for sqlite and turso,
`a & b` for postgres. The match *meaning* is not, and it is worth being explicit
about where the seams are.

## What is measured to be equal

| | sqlite (`unicode61`) | turso | postgres (`simple`) |
|---|---|---|---|
| case folding | ✅ | ✅ | ✅ |
| stop-word removal | ❌ none | ❌ none | ❌ none (`simple` has no stop-list) |
| stemming | ❌ none | ❌ none | ❌ none (`simple` does no stemming) |
| tokenisation of `a@b.com` | splits | splits | splits |
| **prefix search** | ✅ `term*` | ❌ **not supported** | ✅ `term:*` |

Measured on Postgres:

```
to_tsvector('simple','renews') @@ to_tsquery('simple','renewal')  -> f
to_tsvector('english','renews') @@ to_tsquery('english','renewal') -> t
```

**`simple` is the parity config.** It does no stemming and holds no stop-list,
which is the closest match to `unicode61`. `english` is *not* a drop-in: it
stems, so it would silently match more than the other two engines on the same
corpus.

## Consequence for the contract

- `fts.semantics` is a **declared** property, not an implementation detail. A
  consumer that accepts `english` is accepting a different search behaviour, and
  the difference must be visible at the point of choice — never a default.
- The default for postgres in `contracts/engines.json` is **`simple`**.
- **Prefix search is not portable.** sqlite and postgres support it; Turso does
  not. A consumer using prefix search is therefore not engine-agnostic, and that
  is a decision for the consumer, not something a renderer can paper over.
  (No current consumer uses it — worth keeping that way, or declaring it.)

## The match-expression builder is part of the dialect

This is the finding that shaped the model. The core builds
`"invoice" "attached"` — quoted phrases — which Turso's `fts_match` accepts
**verbatim**. `to_tsquery` wants `invoice & attached`.

So the match expression is **not** a constant across engines, and the builder —
not just the SQL around it — is dialect-dependent. That is why the contract
carries `fts.match` as a value rather than leaving the expression to the caller.

Note also what the quoting is *for*: the core quotes each whitespace-delimited
term so user input cannot break the expression. That property has to be
preserved in every dialect's builder — `to_tsquery` needs the terms sanitised
and `&`-joined, not interpolated.

## Ranking

Not currently used by any consumer: sure-mail orders results by the message's own
`internaldate`, not by relevance. The tables carry `fts.ranking`
(`fts_score` for turso, `ts_rank` for postgres, none for sqlite) so that a
consumer which *does* want relevance ordering has a declared, measured value
rather than an invented one — and so the divergence in ranking is visible before
anyone depends on it.
