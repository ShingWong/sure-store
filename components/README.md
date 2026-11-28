# Reusable UI components

This directory is the shared home for **reusable UI components** across the
sure stack — contributed by consuming products (first: `sun-portal`) so that
no product hand-rolls a private copy of a generic control.

**License: MIT** (inherits `../LICENSE`). Components are generic and carry
nothing proprietary; the proprietary value of each product stays in its
domain logic, schema semantics, and configuration — not here.

## What belongs here

- Component *definitions* in the sure-factor catalog YAML form
  (`catalog/components/*.yaml` shape) — that is the machine-readable contract
  the sure-factor generator matches and renders per tier; the class
  vocabulary (`sure-form__*`, `btn-*`, `sure-table__*`, …) is defined by the
  catalog contract and never invented locally.
- Fixture goldens documenting the generated output the component must keep
  producing.

## What does *not* belong here

- Product screens, layouts, route wiring (those are generated per product).
- Anything embedding product-specific field names, wording, or data.

## Current consumers

| consumer | how it consumes |
|---|---|
| `@shing.wong/sure-factor` | generator matches catalog YAML and renders per tier |
| `sun-portal` | `npm run generate` reads these to produce `components/` |

## Adding a component (rule, first stated by sun-portal)

1. Check existing components in this directory and in sure-factor's built-in
   catalog — extend before adding.
2. New component = YAML here + fixture golden in `fixtures/` + a row in the
   verification suite's `EXPECTED` list.
3. Re-run the consuming product's generator; commit generated output in the
   product repo, never drift from it by hand.

## Document parts (the sure-document catalog)

The first five entries of the `sure-document` catalog (`docs/catalog.md` §6)
live here. Each is a sure-factor `CatalogComponent` with the 0.6 document-part
extension (`family`, `data`, `print`, `guards`, `fixture`) plus the two template
blocks sure-factor's generator still requires (`form`, `buttons`):

| Entry | Family | Shape | Guards check |
|---|---|---|---|
| `document-table` | `data` | rows | total equals the sum of row amounts; rows exist |
| `document-totals` | `data` | record | grand total equals subtotal plus tax |
| `document-keyvalue` | `structure` | record | every value is present |
| `document-schedule` | `data` | rows | total equals amounts plus late fees; installments exist |
| `document-graphic` | `figure` | none | the accessible alt text is present |

`document-graphic` additionally declares the published sure-ui `document` and
`figure` blocks; the table entries use `table`. No block is declared that
sure-ui 0.3.7 does not ship.

### Fixture goldens

Every entry's `fixture` is synthetic: seeded (`20261119`), `"synthetic": true`,
with a seed-derived `generatedAt`, invented names, round amounts and future
dates. No product, company or person identifier appears. The private denylist
scan stays in the consuming product's CI.

`fixtures/<name>.golden.json` is the committed replay of the entry: its data
contract, guard projections and results, synthetic replay facts and a digest
of the whole contract. The verification suite:

```
npm run verify:components          # replay all five entries, compare goldens
node verification/run-components.mjs --update   # regenerate goldens (review the diff)
```

runs under plain node with no installed dependency, because the gate job
installs nothing. Its validation rules are a transcription of the published
`@shing.wong/sure-factor@0.6.2` shapes and `@shing.wong/sure-ui@0.3.7` block
list, pinned by `test/components.test.mjs`. Drift in an entry, a guard that
names an undeclared projection, a missing template block, or a non-synthetic
fixture fails the gate loudly.

## Phase D coverage matrix

[`COVERAGE.md`](COVERAGE.md) (generated from [`coverage.json`](coverage.json))
has **one row per catalog entry** across sure-factor's built-in components and
these document parts. Each row records four checks — client render, browser
structure, accessibility and demo — with referenced evidence. `✓` means
evidence exists; `—` is an honest gap, never a pass.

```
npm run verify:coverage                  # matrix matches catalogs; evidence refs resolve
node verification/coverage.mjs --write   # regenerate after catalog changes
node verification/coverage.mjs --strict  # Phase D gate: fails while any row has a gap
```

Cross-repo evidence is checked when sibling `sure-factor` / `sure-examples`
checkouts are present (`SURE_FACTOR_DIR` / `SURE_EXAMPLES_DIR`); CI without them
still validates matrix structure and status consistency. `test/coverage.test.mjs`
pins the honest-gap rule so `--strict` cannot pass until the gaps are real.
