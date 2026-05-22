import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildPwa } from "pues/base/pwa/server";
import { buildStyle } from "pues/base/style";

const root = resolve(import.meta.dirname, "..");

function ensurePlaceholderIcon(path: string): void {
  if (existsSync(path)) return;
  // Tiny PNG placeholder so PWA build can run before branded assets land.
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9WlXQAAAAASUVORK5CYII=";
  writeFileSync(path, Buffer.from(pngBase64, "base64"));
}

mkdirSync(resolve(root, "public"), { recursive: true });
ensurePlaceholderIcon(resolve(root, "public/loggers-192.png"));
ensurePlaceholderIcon(resolve(root, "public/loggers-512.png"));

const styleResult = buildStyle({ root });
console.log(`Style: wrote ${styleResult.path} (${styleResult.bytes} bytes).`);

const { count, size, manifestRevision } = await buildPwa({
  root,
  additionalAssets: [
    { url: "/main.css", path: "src/web/main.css" },
    { url: "/dist/pues.css", path: "public/dist/pues.css" },
    { url: "/loggers-192.png", path: "public/loggers-192.png" },
    { url: "/loggers-512.png", path: "public/loggers-512.png" },
  ],
});

console.log(
  `Service worker: ${count} precache entries, ${size} bytes total ` +
    `(manifest revision ${manifestRevision}).`,
);
