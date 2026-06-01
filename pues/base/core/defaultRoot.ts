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
 * Example: `/work/my-app` -> `my-app`.
 */
export function defaultCoreName(root: string = defaultRoot()): string {
  return basename(resolve(root));
}

/**
 * Resolve the consumer's "app name" from a parsed `config/pues.yaml`,
 * falling back to {@link defaultCoreName} (the checkout-folder basename)
 * when `core.name` is missing, empty, or not a non-empty string. Use
 * everywhere code needs the canonical app identifier — db path, PWA
 * manifest, puesAppMeta codegen, etc. — instead of repeating the
 * fallback shape at each site.
 */
export function resolveCoreName(
  config: { core?: { name?: unknown } } | null | undefined,
  root: string = defaultRoot(),
): string {
  const explicit = config?.core?.name;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return defaultCoreName(root);
}
