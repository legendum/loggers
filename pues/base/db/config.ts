/**
 * Read + validate the `db:` section of `<root>/config/pues.yaml`.
 *
 * Used by `getDb()` at process boot. Throws if the file is missing or
 * unparseable. The `db:` block is fully optional — when absent, the
 * path defaults to `data/<core-name>.db`, where `core-name` resolves
 * from `core.name` or falls back to the host checkout folder name.
 *
 * Synchronous because `getDb()` itself is synchronous (existing pues
 * call sites — `configureAuth({ getDb })`, `mountResource({ db: getDb() })`
 * — assume that). The db part reads pues.yaml directly rather than
 * going through `base/objects/loadPuesConfig`, so a consumer vendoring
 * `db` is not forced to also vendor `objects`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultCoreName } from "../core/defaultRoot";

export type DbConfig = {
  /** Path to the SQLite file. Relative paths resolve against `root`.
   * Optional — defaults to `data/<core-name>.db`. */
  path?: string;
};

export type ResolvedDbConfig = {
  /** Resolved path; never undefined. */
  path: string;
};

export function readDbConfig(root: string): ResolvedDbConfig {
  const yamlPath = join(root, "config/pues.yaml");
  let text: string;
  try {
    text = readFileSync(yamlPath, "utf8");
  } catch (cause) {
    throw new Error(`[pues/db] could not read ${yamlPath}`, { cause });
  }

  const parsed = Bun.YAML.parse(text) as {
    db?: DbConfig;
    core?: { name?: unknown };
  } | null;
  const db = parsed?.db ?? {};
  const coreName =
    typeof parsed?.core?.name === "string" && parsed.core.name.length > 0
      ? parsed.core.name
      : defaultCoreName(root);

  const path = db.path ?? `data/${coreName}.db`;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(
      `[pues/db] ${yamlPath}: cannot resolve DB path. Set 'db.path' explicitly.`,
    );
  }

  return { path };
}
