# Fixture format

Fixtures are **language-neutral**: cases with inputs and machine-readable checks,
no code. A renderer or engine implementation in any language is correct when it
satisfies them, and not before.

- `render.json` asserts exact SQL strings against the reference renderer
  (`verification/run-ts.mjs`).
- `tx.json` and `stmt-shape.json` are **behavioural** and run against real
  engines (`verification/run-behaviour.mjs`).

## A behavioural case

```json
{
  "id": "default-now-rejected",
  "scope": "engine",
  "why": "prose: why this case exists",
  "requires": { "path": "clock.ddlDefaultNow", "equals": false },
  "steps": ["CREATE TABLE ts (id INTEGER PRIMARY KEY, at {types.map.timestamptz} DEFAULT now())"],
  "expects": "reject",
  "errorMatches": "syntax",
  "check": { "rows": 0 },
  "assert": ["prose: the cross-engine truth, including what the runner cannot reach"]
}
```

### `scope`

| value | the case runs once per… | `requires` and `{…}` resolve against |
|---|---|---|
| `engine` (default) | entry in `engines` | the engine entry |
| `binding` | entry in `bindings` | the binding, with the engine merged underneath |

Binding-scoped cases exist because some facts are the driver's, not the engine's:
placeholder style and the result envelope. `params` and `result` must never be
required from an engine entry — they are not there, and looking for them is the
category error [spec/01](../../spec/01-capability-model.md) warns about.

### `requires` — and `equals` / `nonEmpty`

`requires` gates whether the case runs at all.

| form | runs when |
|---|---|
| absent | always |
| `{ "path": "clock.ddlDefault" }` | the resolved value is truthy |
| `{ "path": "clock.ddlDefaultNow", "equals": false }` | the value is **falsey** |
| `{ "path": "types.map.jsonb", "equals": "JSONB" }` | the value equals `"JSONB"` |
| `{ "path": "tx.isolationLevels", "nonEmpty": true }` | the value is a non-empty array |

**`equals: false` is not decoration.** A case that asserts an engine *lacks* a
capability must run on exactly the engines that lack it. Requiring the capability
instead makes the case SKIP there — it would pass by never executing, which is
the most expensive kind of green. Three cases in the FR-2 set had this bug.

**A path that does not resolve is a FAILURE, not a skip.** Paths are nested and
axis-scoped: engine facts under `engines.<engine>.*` (`types.map.jsonb`,
`clock.ddlDefaultNow`, `tx.forUpdate`), binding facts under `bindings.<driver>.*`
(`params`, `result.affectedField`). Writing `types.timestamptz` for
`types.map.timestamptz`, or reading `result.affectedField` off an engine, fails
the case with the offending path named. It must not skip: a skip is
indistinguishable from "the engine genuinely lacks this capability", which is
exactly how a typo becomes a green run. `npm run verify:resolver` proves the
resolver still fires.

### `expects` and `errorMatches`

| value | meaning |
|---|---|
| `"ok"` (default) | every step succeeds, and `check` holds |
| `"reject"` | the **last** step must be refused |

A case-level `reject` applies to the final step, so a case can set up state and
then assert that the statement it cares about is refused. For a step that is
expected to fail *mid-case* — the audit-write case needs to continue after the
violation so it can assert what `ROLLBACK` left behind — use the object form:

```json
{ "sql": "INSERT INTO audit (item_id, note) VALUES (1, NULL)",
  "expects": "reject", "errorMatches": "null" }
```

`errorMatches` is a case-insensitive regex the error message must match. It is
worth setting: a refusal for the *wrong reason* is not the assertion.

### `check` — machine-readable assertions

`assert` is prose for humans and carries cross-engine truth. `check` is what the
runner executes:

| key | asserts |
|---|---|
| `rows` | the last step returned this many rows |
| `first` | the first row's named columns equal these values (`===`) |
| `fields` | the **driver envelope** of the last step contains these keys — binding-scoped cases only |

A column's *type* is asserted by selecting it explicitly — `typeof(x) AS ty` —
rather than with a type-check primitive, so the SQL stays visible.

**What `check` cannot reach:** it is evaluated on the engines the runner can
reach. `verification/run-behaviour.mjs` is dependency-free, so it runs sqlite
always and turso when the driver is installed; **postgres is skipped**. Postgres
shape is documented in `assert` and verified by `verification/live/postgres.sql`.

**And one limit worth knowing:** on an engine with `types.enforced: false`, the
`types.map` is a *recommendation*, not a constraint — the engine accepts any type
name and assigns affinity. So a wrong map entry there is **not detectable by
execution**, because the engine does not care. Verified: changing
`sqlite.types.map.boolean` to `"BOOLEAN"` leaves every case green, correctly.
Only `enforced: true` engines can be checked this way.

### `steps` and substitution

`{path}` tokens are replaced from the resolved object:
`{clock.serverNow}`, `{types.map.timestamptz}`, `{identifierQuote}`,
`{serverInfo}`. A token whose path does not resolve **fails the case**; it never
survives into the SQL as literal text.

`{ph}` is the **placeholder** for the current binding, rendered from
`bindings.<name>.params` and **numbered in order**, so a dollar-style binding
turns `LIMIT {ph} OFFSET {ph}` into `LIMIT $1 OFFSET $2`.

`binds` applies to the **final** step — the one whose result is checked.

### The runner obligation

1. **Fresh database per case.** State must not leak between cases.
2. **Check `requires` first**, and report a non-run as **SKIPPED**.
3. **Skip is a result, not a failure.** "This engine cannot express it" and "this
   engine failed it" are different facts, and only one is a defect. A suite that
   reports a skip as a pass is as wrong as one that reports it as a failure.
4. Honour `expects: "reject"` by asserting the refusal — never by letting the
   error escape and treating the crash as a pass.
