// @shing.wong/sure-store-driver-node-sqlite
//
// The `node:sqlite` binding, as a driver.
//
// A driver is the object a consumer holds: it opens a connection and binds
// parameters. It is deliberately not a pool, a transaction policy or a schema
// migrator — `txOwnership` is an axis in the contract precisely because those
// belong to the caller, not to the binding.
//
// Dependency direction: consumer -> this -> @shing.wong/sure-store. The driver
// carries its binding library's API (DatabaseSync) and nothing about the
// dialect: the facts it depends on are read out of `bindings["node:sqlite"]`,
// and it refuses to run when the contract stops describing what it does.

import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import { loadDocument } from "@shing.wong/sure-store";

/** The binding this driver implements. Named per binding, never per engine. */
export const binding = "node:sqlite";

/**
 * What `run` returns: node:sqlite's own envelope, unrenamed.
 *
 * Renaming here would hide the very fact binding-scoped fixtures assert — a
 * consumer reads `bindings["node:sqlite"].result.affectedField` from the
 * contract and finds `changes`. The driver reports what the driver reports.
 */
export interface DriverEnvelope {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Queryable {
  /** Rows for a statement that returns them. */
  all(sql: string, params?: readonly SQLInputValue[]): Record<string, unknown>[];
  /** The raw envelope for one statement. */
  run(sql: string, params?: readonly SQLInputValue[]): DriverEnvelope;
  /** A multi-statement script. sqlite binds no parameters through exec(). */
  exec(sql: string): void;
  close(): void;
}

export interface OpenOptions {
  /** Open the database read-only instead of creating it. */
  readOnly?: boolean;
}

interface BindingFacts {
  params?: string;
  result?: {
    affectedField?: string | null;
    insertIdField?: string | null;
  };
}

interface Document {
  bindings?: Record<string, BindingFacts | string | undefined>;
}

/**
 * Fail closed when the contract no longer describes this binding.
 *
 * The driver binds positionally and reports `changes` / `lastInsertRowid`
 * because that is what node:sqlite does. If the tables say otherwise, one of the
 * two is wrong and the driver does not get to guess which. This is also the
 * entry criterion for the slot made checkable: every fact the driver relies on
 * is one the contract carries, and the driver refuses when that stops being so.
 */
export function assertBindingSupported(doc: Document = loadDocument() as Document): void {
  const facts = doc.bindings?.[binding];
  if (!facts || typeof facts === "string") {
    throw new Error(`sure-store: the contract does not describe the "${binding}" binding`);
  }
  if (facts.params !== "positional-q") {
    throw new Error(
      `sure-store: "${binding}" declares params "${facts.params}", but this driver binds ` +
        `positionally ("?"). Refusing to guess — see bindings in contracts/engines.json.`,
    );
  }
  const affectedField = facts.result?.affectedField;
  const insertIdField = facts.result?.insertIdField;
  if (affectedField !== "changes" || insertIdField !== "lastInsertRowid") {
    throw new Error(
      `sure-store: "${binding}" declares result fields ` +
        `${JSON.stringify({ affectedField, insertIdField })}, but node:sqlite reports ` +
        "changes/lastInsertRowid.",
    );
  }
}

/**
 * Open a connection. `path` defaults to an in-memory database, which is what a
 * test or a scratch check wants; a real consumer passes its store's path.
 */
export function open(path = ":memory:", options: OpenOptions = {}): Queryable {
  assertBindingSupported();
  // options must be an object even when empty: DatabaseSync(path, undefined) throws.
  const db = new DatabaseSync(path, { readOnly: Boolean(options.readOnly) });
  return {
    all(sql, params = []) {
      return db.prepare(sql).all(...(params as SQLInputValue[])) as Record<string, unknown>[];
    },
    run(sql, params = []) {
      return db.prepare(sql).run(...(params as SQLInputValue[])) as unknown as DriverEnvelope;
    },
    exec(sql) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}
