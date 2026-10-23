# @shing.wong/sure-store-driver-node-sqlite

The `node:sqlite` binding, as a driver for [`@shing.wong/sure-store`](../..).

MIT. No runtime dependency beyond node's own `node:sqlite` and the contract
package.

```js
import { open } from "@shing.wong/sure-store-driver-node-sqlite";

const db = open();                      // in-memory; pass a path for a real store
db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
db.run("INSERT INTO t (name) VALUES (?)", ["a"]);
console.log(db.all("SELECT id, name FROM t"));   // [ { id: 1, name: 'a' } ]
db.close();
```

## What it is

A **driver**, which in this project means an object that opens a connection and
binds parameters — nothing else. It is not a pool, not a transaction policy, not
a migrator. `txOwnership` is an axis in the contract because those decisions
belong to the caller.

| method | returns | notes |
|---|---|---|
| `all(sql, params?)` | rows | for statements that return rows |
| `run(sql, params?)` | `{ changes, lastInsertRowid }` | the binding's own envelope, unrenamed |
| `exec(sql)` | — | multi-statement scripts; sqlite binds nothing through it |
| `close()` | — | |

`params` is positional: this binding is `positional-q`, so `?` only. Composing
`$1` or `:name` is a different binding, and a second driver.

## What it deliberately does not do

It does not rename the result envelope. `bindings["node:sqlite"].result` in the
contract says the affected-row count arrives as `changes` and the id as
`lastInsertRowid`; the driver hands those back as they are, so a consumer reads
one documented field instead of guessing. Normalising here would hide the fact
that binding-scoped fixtures exist to assert.

It does not carry dialect facts. Every fact it relies on is read from
`bindings["node:sqlite"]`, and `open()` refuses when the contract no longer
describes it (`assertBindingSupported`) — a contract that moves out from under a
driver is an error, never a guess.

It does not pick defaults. The path is the caller's, `:memory:` is a test
convenience, and no database name or user is baked in. Consumer defaults are
facts too, and they belong above the driver.

## Conformance

The fixtures are the contract, so the driver is checked by running them through
the shared runner rather than by a bespoke test suite:

```bash
npm run build -w @shing.wong/sure-store-driver-node-sqlite
node verification/run-behaviour.mjs --driver node:sqlite=drivers/node-sqlite/dist/index.js
```

`--driver` names a binding and a path; the runner loads it and keeps its own
adapter logic, because that logic is a verification rule ("single statements go
through `run()` so the envelope is observable"), not a driver fact. Nothing here
is imported by sure-store: the dependency is one-directional, consumer → driver
→ contract.

In this repository the contract resolves to the local checkout through a
`file:../..` **dev** dependency: npm has no `workspace:` protocol, and the root
package is not a linkable workspace package, so a plain `^x.y.z` range would
fetch the published copy while you are changing the local one. The runtime
`dependencies` range is what a consumer resolves; the dev dependency only decides
what this checkout builds against.
