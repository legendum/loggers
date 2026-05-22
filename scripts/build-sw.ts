import { resolve } from "node:path";
import { buildPwa } from "pues/base/pwa/server";
import { buildStyle } from "pues/base/style";

const root = resolve(import.meta.dirname, "..");

const styleResult = buildStyle({ root });
console.log(`Style: wrote ${styleResult.path} (${styleResult.bytes} bytes).`);

const { count, size, manifestRevision } = await buildPwa({
  root,
  additionalAssets: [
    { url: "/main.css", path: "src/web/main.css" },
    { url: "/dist/pues.css", path: "public/dist/pues.css" },
    { url: "/loggers.png", path: "public/loggers.png" },
    { url: "/loggers-192.png", path: "public/loggers-192.png" },
    { url: "/loggers-512.png", path: "public/loggers-512.png" },
  ],
});

console.log(
  `Service worker: ${count} precache entries, ${size} bytes total ` +
    `(manifest revision ${manifestRevision}).`,
);
