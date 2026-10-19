# AGENTS.md — working rules for sure-store

## What this repo is

An **engine-agnostic storage contract** shared by sure-mail, sure-factor, memeng
and pai-core. It holds the dialect tables, the spec, per-language reference
renderers, and the verification suite. It does **not** hold any consumer's
schema.

The asset is **measurement**. Every claim in `contracts/engines.json` must be
reproducible against a live engine, and the probe that proves it belongs in
`verification/live/`.

## Hard rules

- **Never write a dialect fact from memory.** Run it. Two traps already cost
  real debugging time (`fts_match` taking columns not the index name; Postgres
  parsing `INTEGER PRIMARY KEY` without auto-assigning it) and both were found
  by executing, not reading.
- **`contracts/engines.json` is the single source of truth.** Renderers derive
  from it. If a renderer needs a fact the table does not carry, add the fact to
  the table — do not hard-code it in the renderer.
- **The fixtures are the contract.** A new language implementation is correct
  when it satisfies `verification/fixtures/`, and not before.
- **Fail closed.** An engine or capability the tables do not describe must
  produce an error, never a guessed dialect. Silent wrong SQL is worse than a
  refusal.
- **MIT only.** No dependency and no contributed code that is not
  MIT-compatible. The AGPL-or-commercial consumers (memeng, pai-core) can
  consume this repo; nothing from them may be copied into it.
- **Contributions are MIT, whatever the contributor's own licence.** A consumer
  whose repo is copyleft (GPL-3.0, AGPL) may *use* this repo freely — MIT can be
  consumed by copyleft — but code contributed *into* it must be MIT-licensed by
  the person contributing it. Say so explicitly in the contribution. Do not
  contribute code you cannot relicense.
- **No consumer's schema here.** sure-mail's mailbox, memeng's brain and
  sure-factor's app tables stay in their own repos.

## How to work here

- Evidence before synthesis: run the probe, then write the spec sentence.
- Prefer editing existing files over creating new ones. The spec is numbered
  (`spec/01-…`); extend the existing document for its topic.
- Keep the JSON tables and the spec in step in the same commit. A table entry
  without a spec sentence — or the reverse — is an incomplete change.
- Validate before calling anything done:
  ```bash
  npm run verify    # shared fixtures against the reference renderer
  npm test
  ```
- Commit per stage. Imperative, scoped (`spec: …`, `contract: …`, `impl(ts): …`).

## Adding an engine

1. Run the probes from `verification/live/` against it; record the raw output in
   the commit message.
2. Add the entry to `contracts/engines.json` and extend
   `contracts/engines.schema.json` if the shape needs it.
3. Add the fixtures it must satisfy.
4. Only then touch a renderer.

## Adding a language

The obligation is: read `contracts/engines.json`, satisfy
`verification/fixtures/`, ship a runner that proves it. See
`docs/guide.md` § Porting.
