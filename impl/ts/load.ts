// Node loader for the contracts. Kept separate from render.ts so the renderer
// stays pure and testable: this is the only module that touches the filesystem.
//
// Non-Node consumers (AssemblyScript, Python) do not use this — they read
// contracts/engines.json directly. See docs/guide.md § Porting.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { EngineMap } from "./render.ts";

/** Load contracts/engines.json, or an explicit path. */
export function loadContracts(path?: string): EngineMap {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = path ?? join(here, "..", "..", "contracts", "engines.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    specVersion: string;
    engines: EngineMap;
  };
  return parsed.engines;
}

/** The spec version the tables declare, so a consumer can pin it. */
export function specVersion(path?: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = path ?? join(here, "..", "..", "contracts", "engines.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { specVersion: string };
  return parsed.specVersion;
}
