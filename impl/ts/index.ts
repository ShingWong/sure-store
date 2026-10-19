// @shing.wong/sure-store — the TypeScript reference implementation.
//
// A reference, not a required dependency: the contract is the JSON tables, and
// any language can consume them. This module exists so TypeScript consumers
// (sure-factor, pai-core) get the rendering for free, and so there is a
// worked example of what the fixtures demand.

export {
  getEngine,
  renderMatchParam,
  renderFtsDdl,
  ftsSyncStatements,
  renderSearch,
} from "./render.ts";

export type {
  EngineContract,
  EngineMap,
  EngineFts,
  FtsMatch,
  FtsDdlOptions,
  SearchOptions,
} from "./render.ts";

export { loadContracts, specVersion } from "./load.ts";
