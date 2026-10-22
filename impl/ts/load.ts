// Node loader for the contracts. Kept separate from render.ts so the renderer
// stays pure and testable: this is the only module that touches the filesystem.
//
// Non-Node consumers (AssemblyScript, Python) do not use this — they read
// contracts/engines.json directly. See docs/guide.md § Porting.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { EngineMap, TypeAxis } from "./render.ts";

/**
 * The package's contracts file: the nearest ancestor of this module holding
 * contracts/engines.json.
 *
 * Not a fixed `../../`: this module is loaded from impl/ts in the repository and
 * from dist/ in the published package, so the depth differs. Walking up keeps
 * both working and keeps the published layout honest.
 */
function contractFile(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "contracts", "engines.json");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("sure-store: contracts/engines.json not found next to the installed package");
}

export interface ContractDocument {
  specVersion: string;
  engines: EngineMap;
  bindings: Record<string, unknown>;
  typeAxis: TypeAxis;
}

/**
 * Load the whole contract, or an explicit path.
 *
 * `loadContracts` returns only the engines; the axis and the bindings are equally
 * public contract facts (a consumer that needs binding styles should not have to
 * re-parse the JSON to reach them).
 */
export function loadDocument(path?: string): ContractDocument {
  const file = path ?? contractFile();
  return JSON.parse(readFileSync(file, "utf8")) as ContractDocument;
}

/** Load contracts/engines.json, or an explicit path. */
export function loadContracts(path?: string): EngineMap {
  return loadDocument(path).engines;
}

/** The spec version the tables declare, so a consumer can pin it. */
export function specVersion(path?: string): string {
  const file = path ?? contractFile();
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { specVersion: string };
  return parsed.specVersion;
}
