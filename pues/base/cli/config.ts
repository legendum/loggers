/**
 * On-disk config helpers for CLIs.
 *
 * Two layers:
 *
 *  1. **Project file** — a `KEY=value` line in a file at the repo root.
 *     Defaults to `.env` (the loggers/fifos/todos convention:
 *     `LOGGERS_ULID`, `FIFOS_ULID`, `TODOS_LIST_URL`), but the file is a
 *     parameter so a consumer can keep its credential in a dedicated,
 *     always-gitignored file instead — `dj` uses `.dojo` so the Dojo
 *     write-secret never shares the app's committed `.env`. Read/write
 *     touch only the one key, preserving the rest of the file.
 *
 *  2. **Global config** — a YAML doc at `~/.config/<app>/<app>.yaml`,
 *     for cross-project defaults / aliases (loggers' named loggers,
 *     dj's account-wide settings). The shape is the consumer's; this
 *     layer only reads/writes the document.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Absolute path to `<cwd>/<file>` (default `.env`). */
export function projectFilePath(file = ".env"): string {
  return join(process.cwd(), file);
}

/** Read the trimmed value of `KEY=…` from the project file, or null. */
export function readProjectValue(key: string, file = ".env"): string | null {
  const path = projectFilePath(file);
  if (!existsSync(path)) return null;
  const m = readFileSync(path, "utf-8").match(new RegExp(`^${key}=(.+)$`, "m"));
  return m?.[1]?.trim() || null;
}

/** Upsert `KEY=value` in the project file, preserving other lines. */
export function writeProjectValue(
  key: string,
  value: string,
  file = ".env",
): void {
  const path = projectFilePath(file);
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (!existsSync(path)) {
    writeFileSync(path, `${line}\n`, "utf-8");
    return;
  }
  const current = readFileSync(path, "utf-8");
  if (pattern.test(current)) {
    writeFileSync(path, current.replace(pattern, line), "utf-8");
    return;
  }
  const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${current}${sep}${line}\n`, "utf-8");
}

/** `~/.config/<app>/<app>.yaml`. */
export function globalConfigPath(app: string): string {
  const home = process.env.HOME?.trim() ?? "~";
  return join(home, ".config", app, `${app}.yaml`);
}

/** Parse the global config doc; null when missing or unparseable. */
export function readGlobalConfig(app: string): Record<string, unknown> | null {
  const path = globalConfigPath(app);
  if (!existsSync(path)) return null;
  try {
    const parsed = Bun.YAML.parse(readFileSync(path, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Write the global config doc (creating `~/.config/<app>/`); returns its path. */
export function writeGlobalConfig(
  app: string,
  root: Record<string, unknown>,
): string {
  const path = globalConfigPath(app);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Bun.YAML.stringify(root, null, 2), "utf-8");
  return path;
}
