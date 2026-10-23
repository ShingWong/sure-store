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
npm run ci        # the whole gate: security + tests + JSON + verification
```

or individually:

```bash
npm run security:check   # no keys, credentials, PII, private IPs, env paths
npm test                 # proves the scanner fires and allows look-alikes
npm run verify           # shared fixtures against the TS reference impl
npm run check:contracts  # the tables and fixtures are valid JSON
```

CI runs exactly this set (`.github/workflows/ci.yml`), with a **full-history
checkout** — the security gate inspects commit author and committer identities,
and a shallow clone would silently skip them, which is precisely how a personal
address reaches a public repo.

The live probes under `verification/live/` re-run the measurements above against
real engines (sqlite, Turso, Postgres) so the tables cannot drift from reality.

## Status

**0.1.0 — the contract is measured; one reference implementation exists.
Private until it is stable.**

The repository is **private on purpose, not as a default**: the tables are still
moving (0.1.0, unreleased), and a public contract that changes weekly teaches
consumers to pin a snapshot and stop reading it. It becomes public when the
stability bar below is met — at which point the security gate has already been
running since the first commit, because history is permanent and cannot be
retroactively cleaned.

**Stability bar** (proposed; the last item is the one that actually protects
consumers):

- [ ] the open questions in `spec/04` are resolved or deferred with a stated reason
- [x] the behavioural suites run green against **all three** engines — no engine
      permanently skipped for want of a driver or a server in CI (the `behaviour`
      job in CI: sqlite, Turso and a Postgres service, with `--require-all`)
- [ ] the fixture format is final (it is the contract, so changing it later
      breaks every implementation at once)
- [ ] at least one consumer depends on the published package and its own gates
      pass against it — a contract nobody consumes is a hypothesis

- ✅ the capability model and the measured engine matrix (`spec/`)
- ✅ `contracts/engines.json` + JSON Schema
- ✅ a TypeScript reference renderer + fixtures that pin it
- ✅ the live probes that produced the measurements
- ✅ a compiled package entry (`dist/`, plain-node consumable)
- ✅ parameter-style rendering driven by `bindings.<b>.params` (compose-time, not
  a textual rewrite — `?` is also the jsonb existence operator)
- ⬜ full introspection (tables / columns / PK / FK) and a canonical type axis
- ⬜ the Python and AssemblyScript renderers (the fixtures define their job)
- ⬜ the shared schema DSL (sure-factor's `SchemaInfo` is the candidate) — see
  `spec/04-open-questions.md`

## License

MIT. Deliberately: the AGPL-or-commercial projects (memeng, pai-core) can consume
MIT, and the reverse is not true — so MIT is the only license that serves all
four consumers.
