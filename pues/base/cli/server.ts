/**
 * `base/cli` — the server-only barrel for the fleet's CLI plumbing.
 *
 * A CLI part has no browser audience, so (like `base/db`) it ships a
 * single `/server` barrel and no client-safe default — consumers
 * `import { … } from "pues/base/cli/server"`. It bundles the argv parser,
 * terminal/stdin IO, an HTTP+JSON client, output formatting, on-disk
 * config (project file + global YAML), the credential-resolution ladder,
 * the `SKILL.md` installer, and ULID helpers (re-exported from `core`).
 *
 * Everything here assumes the Bun runtime (`node:fs`, `process`,
 * `Bun.YAML`, global `fetch`). Consumers keep their own `main()`,
 * command dispatch, and help text; this removes the plumbing each CLI
 * would otherwise re-type.
 */

export type { FlagValue, ParsedArgs, ParseOptions } from "./args";
export { parseArgs } from "./args";
export {
  globalConfigPath,
  projectFilePath,
  readGlobalConfig,
  readProjectValue,
  writeGlobalConfig,
  writeProjectValue,
} from "./config";
export type { Format } from "./format";
export { formatPayload, pickFormat, printPayload } from "./format";
export type { FetchResult } from "./http";
export { asObject, dieFromHttp, getString, parseJSON, request } from "./http";
export { prompt, readLineSync, readStdin } from "./io";
export type { InstallSkillOptions } from "./skill";
export { installSkill, skillSourceCandidates } from "./skill";
export type { ResolvedTarget, TargetSource, TargetSpec } from "./target";
export { resolveTarget } from "./target";

export {
  bytesToUlid,
  isUlid,
  normalizeUlid,
  ULID_RE,
  ulid,
  ulidPattern,
  ulidTime,
  ulidToBytes,
} from "./ulid";
