# Live probes

These are the probes that produced every value in `contracts/engines.json`.
They exist so a claim can be **re-run**, not trusted — see AGENTS.md.

| probe | engine | run it |
|---|---|---|
| `sqlite.mjs` | sqlite (node:sqlite, built in) | `node --experimental-strip-types verification/live/sqlite.mjs` |
| `turso.mjs` | turso | `npm i -D @tursodatabase/database` then `node --experimental-strip-types verification/live/turso.mjs` |
| `postgres.sql` | postgres | `psql -v ON_ERROR_STOP=0 -f verification/live/postgres.sql` against a throwaway database |
| `tx-matrix.mjs` | sqlite + turso | `node verification/live/tx-matrix.mjs` |
| `tx-matrix-pg.sh` | postgres | `sudo bash verification/live/tx-matrix-pg.sh` (needs a local server) |
| `sqlite-fts5-sync.cjs` | sqlite | `node verification/live/sqlite-fts5-sync.cjs` — the external-content sync forms |

`sqlite.mjs` and `turso.mjs` are **contract-driven**: they render the SQL from
`contracts/engines.json`, so they prove the table *and* the reference renderer
against a real engine at once. If the table drifts from reality, they fail.

The other probes are deliberately plain — they report a capability matrix rather
than asserting, because their job is to *produce* a measurement a human then
writes into the table.

## What the probes already caught

- **`sqlite-fts5-sync.cjs`**: `DELETE FROM <fts5 external-content table>` is
  **not valid** — it raises `database disk image is malformed` for a rowid not in
  the index. It happens to work when the row *is* indexed, which is why it looks
  fine in a re-store and fails on a first store. Confirmed on SQLite 3.45.1 and
  3.51.3, so this is behaviour, not version drift. The correct pattern is the
  standard trigger pair.
- **`tx-matrix.mjs`**: three claims that had been *asserted* by FR-1 turned out
  otherwise — `RETURNING` works on modern SQLite, a partial unique index **is**
  expressible on Turso, and `BEGIN IMMEDIATE` is the SQLite/Turso construct that
  Postgres rejects (not the other way round).

## Not runnable here

`tx-matrix-pg.sh` needs a local Postgres and root to reach the `postgres` role.
`turso.mjs` and `tx-matrix.mjs`'s Turso half need the driver installed. Both
skip or report rather than fail when the prerequisite is absent, so the suite
stays runnable anywhere.
