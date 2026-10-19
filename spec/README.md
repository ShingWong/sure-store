# sure-store specification

Normative documents. Numbered; extend the document for its topic rather than
adding a new one.

| | document | what it fixes |
|---|---|---|
| 01 | [Capability model](01-capability-model.md) | the dimensions an engine must declare, and the fail-closed rule |
| 02 | [Engine matrix](02-engine-matrix.md) | the measured values for sqlite, turso, postgres — **normative** |
| 03 | [FTS semantics](03-fts-semantics.md) | what can and cannot be made equal across engines |
| 04 | [Open questions](04-open-questions.md) | undecided: escape syntax, stemming default, shared schema DSL |
| 05 | [The driver slot](05-driver-slot.md) | what a driver sibling is, and the criteria for creating one |

## Conformance levels

Borrowed from ODBC, and deliberately small:

| level | means |
|---|---|
| **Core** | the engine runs the portable subset: tables, indexes, `ALTER TABLE`, parameterised DML, and a version stamp. No full-text search. |
| **Search** | Core **plus** full-text search — the engine's FTS storage, upkeep, match-expression dialect and ranking are all declared in `contracts/engines.json`. |
| **Declared** | anything beyond Search (identity strategy, schema versioning mechanism) is present in the tables. A consumer must not use a capability the engine has not declared. |

Measured today:

| engine | level |
|---|---|
| sqlite | **Search** |
| turso | **Search** |
| postgres | **Search** (text-search config `simple` by default — see 03) |

## The rule that makes it safe

> **No engine-specific SQL without a declared capability.**

A driver that has not declared something must produce an **error**, not a guess.
Silent wrong SQL is the failure mode this whole repository exists to prevent —
see the two traps in [02](02-engine-matrix.md).
