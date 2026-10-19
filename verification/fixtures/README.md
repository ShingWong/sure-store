# Fixture format

Fixtures are **language-neutral**: a list of cases with inputs and assertions, no
code. A renderer or engine implementation in any language is correct when it
satisfies them, and not before.

`render.json` is a different shape — it asserts exact SQL strings against the
reference renderer. Files like `tx.json` and `stmt-shape.json` are **behavioural**:
they describe what an engine must *do*.

## A behavioural case

```json
{
  "id": "default-now-rejected",
  "scope": "engine",
  "why": "prose: why this case exists",
  "requires": { "path": "clock.ddlDefaultNow", "equals": false },
  "steps": ["CREATE TABLE ts (id INTEGER PRIMARY KEY, at {types.timestamptz} DEFAULT now())"],
  "binds": [],
  "expects": "reject",
  "assert": ["the DDL is refused"]
}
```

### `scope`

| value | the case runs once per… | `requires` and `{…}` resolve against |
|---|---|---|
| `engine` (default) | entry in `engines` | the engine entry |
| `binding` | entry in `bindings` | the binding entry, with `{engine.*}` available for its engine |

Binding-scoped cases exist because some facts are the driver's, not the engine's —
placeholder style and the result envelope. `params` and `result` must never be
required from an engine entry; they are not there, and looking for them is the
category error [spec/01](../../spec/01-capability-model.md) warns about.

### `requires` — and the `equals` field

`requires` gates whether the case runs at all.

| form | runs when |
|---|---|
| absent | always |
| `{ "path": "clock.ddlDefault" }` | the resolved value is truthy |
| `{ "path": "clock.ddlDefaultNow", "equals": false }` | the resolved value is **falsey** |
| `{ "path": "types.map.jsonb", "equals": "JSONB" }` | the resolved value equals `"JSONB"` |

**`equals: false` is not decoration.** A case that asserts an engine *lacks* a
capability must run on exactly the engines that lack it. Requiring the capability
instead makes the case SKIP there — it would pass by never executing, which is
the most expensive kind of green.

### `expects`

| value | meaning |
|---|---|
| `"ok"` (default) | the steps must succeed, and `assert` holds |
| `"reject"` | at least one step must be **refused** |

`reject` exists so a case can pin a limitation. Without it, a fixture author
either cannot describe an engine that lacks something, or has to invert the
contract to do it.

### `steps` and substitution

Steps are SQL. `{path}` tokens are replaced from the resolved object:
`{clock.serverNow}`, `{types.timestamptz}`, `{types.map.jsonb}`,
`{identifierQuote}`, `{serverInfo}`. `{ph}` is the **placeholder** for the current
binding — the runner renders it from `bindings.<name>.params`, because the
placeholder is a binding fact.

### The runner obligation

1. **Fresh database per case.** State must not leak between cases.
2. **Check `requires` first**, and report a non-run as **SKIPPED**.
3. **Skip is a result, not a failure.** "This engine cannot express it" and "this
   engine failed it" are different facts, and only one is a defect. A suite that
   reports a skip as a pass is as wrong as one that reports it as a failure.
4. Honour `expects: "reject"` by asserting the refusal — never by letting the
   error escape and treating the crash as a pass.
