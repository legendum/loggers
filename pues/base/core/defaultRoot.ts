import { basename, resolve } from "node:path";

/**
 * Default host checkout root for a vendored pues tree (`<root>/pues/base/<part>/...`).
 * Defined under `base/core/` so three `..` segments reach `<root>`.
 */
export function defaultRoot(): string {
  return resolve(import.meta.dirname, "../../..");
}

/**
 * Default consumer slug from the host checkout root path.
 * Example: `/work/todos` -> `todos`.
 */
export function defaultCoreName(root: string = defaultRoot()): string {
  return basename(resolve(root));
}
