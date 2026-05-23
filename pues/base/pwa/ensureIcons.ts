/**
 * Generate the conventional 192 and 512 PWA icons from a canonical
 * source image, when they don't already exist on disk.
 *
 * Convention (per [[pues-pwa-setup]]): a consumer ships three PNGs in
 * `public/` — the main favicon `${slug}.png`, plus PWA-sized
 * `${slug}-192.png` and `${slug}-512.png`. This function lets a
 * consumer ship only the main image and have the two sizes generated
 * from it on the first build.
 *
 * Scope:
 *   - Only generates the file at the **conventional** path, i.e. when
 *     the resolved `pwa.icon192` / `pwa.icon512` URLs are exactly
 *     `/${slug}-192.png` / `/${slug}-512.png`. Consumers that override
 *     icon URLs in `config/pues.yaml` opt out automatically — they're
 *     declaring "I'm managing these files manually."
 *   - Skips any target that already exists. Manually-authored icons
 *     are never overwritten.
 *   - No-op if the source `public/${slug}.png` is missing — the
 *     existing icon-existence check in `mountPwaRoutes` / SW precache
 *     will surface that as a loud error.
 *
 * Format note: output is PNG to match the manifest URL convention and
 * the broadest PWA-install compatibility. Bun's `Bun.file().image()`
 * also supports `.webp()` and `.jpeg()`; consumers wanting a different
 * format ship the variants themselves and override the icon URLs.
 *
 * Resize uses `fit: "inside"` (preserves aspect ratio, never distorts).
 * Source images should be square — square sources produce exactly N×N
 * output. Non-square sources produce N×M output without distortion;
 * PWA manifests will accept it but render with letterboxing. Consumers
 * who want exact N×N for non-square sources ship the sized icons
 * themselves.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export type EnsurePwaIconsArgs = {
  /** Consumer checkout root. `public/` resolves under this. */
  root: string;
  /** Canonical app slug — the basename of the source image without
   *  extension or size suffix. Pass the result of `resolveCoreName`. */
  slug: string;
  /** Resolved `pwa.icon192` URL, e.g. `/loggers-192.png`. The icon is
   *  generated only when this matches the conventional pattern. */
  icon192Url: string;
  /** Resolved `pwa.icon512` URL, e.g. `/loggers-512.png`. */
  icon512Url: string;
};

export type GeneratedIcon = {
  size: 192 | 512;
  path: string;
};

export type EnsurePwaIconsResult = {
  /** Icons that were generated this run. Empty if nothing needed
   *  doing (already-existing files, or convention not in effect). */
  generated: GeneratedIcon[];
};

const SIZES = [192, 512] as const;

export async function ensurePwaIcons({
  root,
  slug,
  icon192Url,
  icon512Url,
}: EnsurePwaIconsArgs): Promise<EnsurePwaIconsResult> {
  const publicDir = join(root, "public");
  const srcPath = join(publicDir, `${slug}.png`);
  const generated: GeneratedIcon[] = [];

  if (!existsSync(srcPath)) return { generated };

  const conventionalUrl = (size: number) => `/${slug}-${size}.png`;
  const resolvedUrl = { 192: icon192Url, 512: icon512Url } as const;

  for (const size of SIZES) {
    if (resolvedUrl[size] !== conventionalUrl(size)) continue;
    const destPath = join(publicDir, `${slug}-${size}.png`);
    if (existsSync(destPath)) continue;
    await Bun.file(srcPath)
      .image()
      .resize(size, size, { fit: "inside" })
      .png()
      .write(destPath);
    generated.push({ size, path: destPath });
  }

  return { generated };
}
