#!/usr/bin/env python3
"""sure-store behavioural fixtures — a runner in another language.

The claim this file exists to test: *"the fixtures are language-neutral: a
renderer or engine implementation in any language is correct when it satisfies
them, and not before."* (verification/fixtures/README.md)

So this runner is written from that README and from `contracts/engines.json`
alone — Python standard library and `sqlite3`, no JavaScript, no shared code with
`verification/run-behaviour.mjs`. If the two disagree, the format or the contract
is ambiguous, which is exactly what a port is for.

    python3 verification/python/run_fixtures.py [--verbose]

Scope: a driver for **sqlite** only. turso and postgres are reported as SKIPPED
with a reason — a runner that cannot reach an engine has not verified it.
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "verification" / "fixtures"
CONTRACT = json.loads((ROOT / "contracts" / "engines.json").read_text())
VERBOSE = "--verbose" in sys.argv

# What this runner can open. Declared, not guessed: an engine absent here is
# skipped, and the skip is reported.
SUPPORTED_ENGINES = {"sqlite"}
FIXTURE_FILES = ("tx.json", "stmt-shape.json")
RETURNS_ROWS = re.compile(r"^\s*(select|with|pragma)\b", re.IGNORECASE)
TOKEN = re.compile(r"\{([\w.]+)\}")


class Unresolved(Exception):
    """A contract path that does not resolve — never read as 'absent'."""


def resolve(scope: dict[str, Any], dotted: str) -> Any:
    cur: Any = scope
    for key in dotted.split("."):
        if not isinstance(cur, dict) or key not in cur:
            raise Unresolved(f'unresolved contract path "{dotted}"')
        cur = cur[key]
    return cur


def satisfies(requires: dict[str, Any] | None, scope: dict[str, Any]) -> tuple[bool, str]:
    if not requires:
        return True, "no requirement"
    value = resolve(scope, requires["path"])
    if "equals" in requires:
        return value == requires["equals"], f'{requires["path"]} == {json.dumps(requires["equals"])}'
    if requires.get("nonEmpty"):
        non_empty = len(value) > 0 if isinstance(value, list) else bool(value)
        return non_empty, f'{requires["path"]} non-empty'
    return bool(value), f'{requires["path"]} truthy'


def substitute(text: str, scope: dict[str, Any]) -> str:
    """Replace `{path}` tokens from the scope, and `{ph}` with this binding's placeholder."""

    def one(match: re.Match[str]) -> str:
        path = match.group(1)
        if path == "ph":
            style = scope.get("params", "positional-q")
            if style in ("positional-q", "mixed"):
                return "?"
            raise Unresolved(f'this runner binds positionally; "{style}" is not a style it implements')
        return str(resolve(scope, path))

    return TOKEN.sub(one, str(text))


def envelope(cursor: sqlite3.Cursor, binding: dict[str, Any]) -> dict[str, Any]:
    """The driver envelope, named by `bindings.<name>.result` — the contract's names."""
    fields = binding.get("result") or {}
    env: dict[str, Any] = {}
    if fields.get("affectedField"):
        env[fields["affectedField"]] = cursor.rowcount
    if fields.get("insertIdField"):
        env[fields["insertIdField"]] = cursor.lastrowid
    return env


class CaseFailure(Exception):
    pass


def check_result(
    check: dict[str, Any] | None, rows: Any, info: Any, scope: dict[str, Any]
) -> None:
    if not check:
        return
    if "rows" in check:
        actual = 0 if rows is None else len(rows)
        if actual != check["rows"]:
            raise CaseFailure(f'expected {check["rows"]} row(s), got {actual}')
    if "first" in check:
        row = (rows or [{}])[0]
        if not rows:
            raise CaseFailure("expected a row for `first`, got none")
        for column, expected in check["first"].items():
            actual = row.get(column)
            # Compare by value, not by container type: engines differ on numeric
            # representation and the fixture asserts the value.
            if actual != expected and str(actual) != str(expected):
                raise CaseFailure(f"column {column}: expected {expected!r}, got {actual!r}")
    if "fields" in check:
        keys = list((info or {}).keys())
        for raw in check["fields"]:
            field = substitute(str(raw), scope)
            # A declared-but-null fact is the absence of an expectation, not an
            # expectation of a field literally called "null".
            if field in ("null", "undefined"):
                continue
            if field not in keys:
                raise CaseFailure(f'driver result lacks "{field}" (has: {", ".join(keys) or "none"})')


def run_case(case: dict[str, Any], scope: dict[str, Any], binding: dict[str, Any], schema: list[str]) -> None:
    steps = [{"sql": s} if isinstance(s, str) else s for s in case["steps"]]
    case_rejects = (case.get("expects") or "ok") == "reject"

    connection = sqlite3.connect(":memory:")
    connection.isolation_level = None  # the fixture issues BEGIN/COMMIT itself
    try:
        for statement in schema:
            connection.execute(substitute(statement, scope))

        rows: Any = None
        info: Any = None
        rejections = 0

        for index, step in enumerate(steps):
            expects_reject = step.get("expects") == "reject" or (case_rejects and index == len(steps) - 1)
            sql = substitute(step["sql"], scope)
            # `binds` applies to the final step — the one whose result is checked.
            binds = list(case["binds"]) if index == len(steps) - 1 and case.get("binds") else []
            try:
                cursor = connection.cursor()
                cursor.execute(sql, binds) if binds else cursor.execute(sql)
                if expects_reject:
                    raise CaseFailure(f"step {index + 1} should have been refused but succeeded: {sql}")
                if RETURNS_ROWS.match(sql):
                    columns = [d[0] for d in cursor.description or []]
                    rows, info = [dict(zip(columns, r)) for r in cursor.fetchall()], None
                else:
                    rows, info = None, envelope(cursor, binding)
            except CaseFailure:
                raise
            except Exception as err:  # noqa: BLE001 — any refusal is a refusal
                message = str(err).splitlines()[0]
                if not expects_reject:
                    raise CaseFailure(f"step {index + 1} threw: {message} ({sql})") from err
                rejections += 1
                pattern = step.get("errorMatches") or case.get("errorMatches")
                if pattern and not re.search(pattern, message, re.IGNORECASE):
                    raise CaseFailure(f"step {index + 1} threw but not /{pattern}/i: {message}") from err
                rows, info = None, None

        if case_rejects and rejections == 0:
            raise CaseFailure("case expects a refusal; none occurred")

        check_result(case.get("check"), rows, info, scope)
    finally:
        connection.close()


def main() -> int:
    passed = skipped = failed = 0
    failures: list[str] = []

    def attempt(case: dict[str, Any], scope: dict[str, Any], binding: dict[str, Any], schema: list[str], label: str) -> None:
        nonlocal passed, skipped, failed
        try:
            should_run, why = satisfies(case.get("requires"), scope)
        except Unresolved as err:
            failed += 1
            failures.append(f'{case["id"]} [{label}] — {err}')
            return
        if not should_run:
            skipped += 1
            if VERBOSE:
                print(f'  SKIP {case["id"]} [{label}] — not declared ({why})')
            return
        try:
            run_case(case, scope, binding, schema)
        except CaseFailure as err:
            failed += 1
            failures.append(f'{case["id"]} [{label}] — {err}')
            if VERBOSE:
                print(f'  FAIL {case["id"]} [{label}]')
            return
        passed += 1
        if VERBOSE:
            print(f'  PASS {case["id"]} [{label}]')

    for fixture_file in FIXTURE_FILES:
        fixture = json.loads((FIXTURES / fixture_file).read_text())
        schema = fixture.get("schema", [])
        if VERBOSE:
            print(f'\n{fixture_file} — {fixture["id"]}')

        for case in fixture["cases"]:
            if case.get("scope", "engine") == "engine":
                for engine_name, engine in CONTRACT["engines"].items():
                    if engine_name not in SUPPORTED_ENGINES:
                        skipped += 1
                        if VERBOSE:
                            print(f'  SKIP {case["id"]} [{engine_name}] — no driver in this runner')
                        continue
                    attempt(case, engine, {}, schema, engine_name)
            else:
                for binding_name, binding in CONTRACT["bindings"].items():
                    if isinstance(binding, str):
                        continue  # the section carries a prose `note` beside the bindings
                    if binding["engine"] not in SUPPORTED_ENGINES:
                        skipped += 1
                        if VERBOSE:
                            print(f'  SKIP {case["id"]} [{binding_name}] — no driver in this runner')
                        continue
                    scope = {**CONTRACT["engines"][binding["engine"]], **binding}
                    attempt(case, scope, binding, schema, binding_name)

    print(f"\nbehavioural fixtures (python) — {passed} passed, {skipped} skipped, {failed} failed")
    for line in failures:
        print(f"  FAIL {line}")
    if failed:
        return 1
    print("all good")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
