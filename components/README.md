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
2. New component = YAML here + fixture test in the `verification/` suite.
3. Re-run the consuming product's generator; commit generated output in the
   product repo, never drift from it by hand.
