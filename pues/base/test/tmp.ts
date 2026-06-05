/**
 * `makeTempDir` — a throwaway directory under the OS tmpdir, with a `cleanup()`.
 * For CLI/SDK tests that need a scratch working dir (project files, written
 * fixtures, a fake `$HOME`).
 *
 *   const t = makeTempDir("dj-cli-");
 *   await Bun.write(join(t.dir, ".dojo"), "DOJOS_ULID=…");
 *   // ...run the CLI in t.dir...
 *   t.cleanup();
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TempDir = { dir: string; cleanup: () => void };

export function makeTempDir(prefix = "pues-test-"): TempDir {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
