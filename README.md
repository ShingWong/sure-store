# sure-store

**An engine-agnostic storage contract.** Not a library you call — a *spec*, a set
of machine-readable dialect tables, and a verification suite shared by four
projects that each own their own schema.

| consumer | language | the schema it owns |
|---|---|---|
| [sure-mail](https://github.com/ShingWong/sure-mail) | AssemblyScript (WASM core) + hosts | mailbox: `messages`, `folders`, `accounts`, `drafts`, `sent_messages` |
| [sure-factor](https://github.com/ShingWong/sure-factor) | TypeScript | introspects an app schema → UI |
| memeng (`positronic-engram`) | Python | brain: `episode`, `object`, `stream` |
| pai-core (`positronic-agent-interface`) | TypeScript | brain store (`BrainDb`) |

**What is shared is not the schema.** Each project keeps its own. What is shared
is the expensive part: *what it costs to run any schema on different engines.*

## Why this exists

Three engines are in play and they are **not** interchangeable:

| dimension | sqlite | turso | postgres |
|---|---|---|---|
| FTS storage | `fts5` virtual table | `CREATE INDEX … USING fts` | generated `tsvector` + GIN |
| FTS index upkeep | the **core** emits 2 sync statements | the **engine** maintains it | the **engine** (generated column) |
| match expression | `"a" "b"` | `"a" "b"` (same) | `a & b` |
| schema version | `PRAGMA user_version` | same | a version table |
| column probe | `pragma_table_info` | same | `information_schema.columns` |
| primary-key identity | rowid alias | same | `GENERATED … AS IDENTITY` |

Every row of that table was **measured against a live engine**, not read from
documentation. Two of them are traps that cost real debugging time:

- **Turso's `fts_match` takes the columns, not the index name.** Passing the
  index name parses and returns *silently empty*.
- **Postgres parses `id INTEGER PRIMARY KEY` and does not auto-assign it.** A
  portability check that stops at "did the DDL apply?" reports success and is
  wrong — the failure only appears when an insert omits `id`.

That is the point of this repo: the measurements are the asset.

## Lineage — this is the ODBC model, not ODBC

ODBC works because it standardises the **API and the metadata** (drivers, a
driver manager, `SQLGetInfo` capability queries, `SQLGetDiagRec` diagnostics)
and leaves the SQL dialect to the application, with a small **escape vocabulary**
(`{fn …}`, `{oj …}`, `{d …}`) that the driver expands.

It has never delivered dialect portability — that is the oldest complaint about
it — and we should not expect to either. What we can do is copy the good part:

- a stable call surface (in sure-mail that already exists: the `store.*` port),
- a **declaration** of what the driver can do (this repo's contracts),
- and **fail closed** when a driver has not declared something the core needs —
  never guess a dialect.

ODBC itself is unusable here (a C API, a driver manager, no browser/WASM story).
The *model* is free.

### The limit worth stating plainly

**You can abstract syntax. You cannot abstract semantics.**

`to_tsvector('english', …)` stems and drops stop-words; FTS5's `unicode61` does
neither. Same corpus, different matches. Measured:

```
to_tsvector('simple','renews') @@ to_tsquery('simple','renewal')  -> f
to_tsvector('english','renews') @@ to_tsquery('english','renewal') -> t
```

So the default text-search config for Postgres is **`simple`**, which is the
closest parity with `unicode61`; `english` is an opt-in that *declares* the
divergence rather than hiding it. See `spec/03-fts-semantics.md`.

## Shape

```
spec/          normative documents (the model, the measured matrix, semantics)
contracts/     machine-readable dialect tables + JSON Schema  ← the shared asset
impl/          reference renderers, one per language
verification/  language-neutral fixtures, per-language runners, live probes
docs/          the programmer's guide
```

**`contracts/engines.json` is the deliverable.** Any language can consume it —
AssemblyScript and Python cannot import an npm package, so the tables are JSON
and each project writes a thin renderer against them.

## Consuming it

**TypeScript** (sure-factor, pai-core):

```ts
import { engines, renderFtsDdl, renderSearch } from "@shing.wong/sure-store";
```

**Anything else** (AssemblyScript, Python): read `contracts/engines.json`
directly and implement the renderer against the fixtures in
`verification/fixtures/`. The fixtures are the contract — if your renderer
satisfies them, it agrees with every other implementation.

## Verification

```bash
npm run verify    # run the shared fixtures against the TS reference impl
npm test          # the reference impl's own tests
```

The live probes under `verification/live/` re-run the measurements above against
real engines (sqlite-wasm, Turso, Postgres) so the tables cannot drift from
reality.

## Status

**0.1.0 — the contract is measured; one reference implementation exists.**

- ✅ the capability model and the measured engine matrix (`spec/`)
- ✅ `contracts/engines.json` + JSON Schema
- ✅ a TypeScript reference renderer + fixtures that pin it
- ✅ the live probes that produced the measurements
- ⬜ the Python and AssemblyScript renderers (the fixtures define their job)
- ⬜ the shared schema DSL (sure-factor's `SchemaInfo` is the candidate) — see
  `spec/04-open-questions.md`

## License

MIT. Deliberately: the AGPL-or-commercial projects (memeng, pai-core) can consume
MIT, and the reverse is not true — so MIT is the only license that serves all
four consumers.
