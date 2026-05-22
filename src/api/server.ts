import { join, resolve } from "node:path";
import {
  configureAuth,
  mountAuthRoutes,
  mountLegendum,
  mountUserSettings,
  withSelfHostedSession,
} from "pues/base/auth/server";
import { getDb } from "pues/base/db/server";
import { mountPwaRoutes } from "pues/base/pwa/server";
import { PORT } from "../lib/constants.js";
import { closeBillingTabs } from "../lib/billing.js";
import { json } from "./json.js";

const root = resolve(import.meta.dir, "../..");

let bundleFile: string | null = null;
async function getBundleFilename(): Promise<string | null> {
  if (bundleFile) return bundleFile;
  try {
    const glob = new Bun.Glob("entry-*.js");
    for await (const f of glob.scan(join(root, "public/dist"))) {
      bundleFile = f;
      return f;
    }
  } catch {
    // build output not present yet
  }
  return null;
}

async function serveStatic(
  filePath: string,
  contentType: string,
  cacheControl?: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(file, {
    headers: {
      "Content-Type": contentType,
      ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
      ...(extraHeaders ?? {}),
    },
  });
}

async function serveIndex(): Promise<Response> {
  const bundle = await getBundleFilename();
  const scriptTag = bundle
    ? `<script type="module" src="/dist/${bundle}"></script>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <meta name="theme-color" content="#0f172a" />
    <title>Loggers</title>
    <link rel="icon" type="image/png" href="/loggers.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/loggers-192.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/loggers-512.png" />
    <link rel="apple-touch-icon" href="/loggers-192.png" />
    <link rel="manifest" href="/manifest.json" />
    <link rel="stylesheet" href="/dist/pues.css" />
    <link rel="stylesheet" href="/main.css" />
  </head>
  <body>
    <div id="root"></div>
    ${scriptTag}
  </body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

getDb();
configureAuth({ getDb });

const pwa = await mountPwaRoutes({ root });

export default {
  port: PORT,
  development: !!process.env.DEV,
  idleTimeout: 255,
  routes: {
    ...mountAuthRoutes(),
    ...mountLegendum(),
    ...mountUserSettings(),
    ...pwa.routes,
    "/api/health": {
      GET: () => json({ ok: true }),
    },
  },
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    const pwaHit = await pwa.fetch(req);
    if (pwaHit) return pwaHit;

    if (method === "GET") {
      if (path === "/main.css") {
        return serveStatic(join(root, "src/web/main.css"), "text/css");
      }
      if (path === "/dist/pues.css") {
        return serveStatic(join(root, "public/dist/pues.css"), "text/css");
      }
      if (path === "/loggers.png") {
        return serveStatic(join(root, "public/loggers.png"), "image/png");
      }
      if (path.startsWith("/dist/")) {
        const safe = path.replace(/\.\./g, "");
        return serveStatic(
          join(root, "public", safe),
          "application/javascript",
          "public, max-age=31536000, immutable",
        );
      }
    }

    const acceptNav = req.headers.get("Accept") ?? "";
    const isPageNavigation =
      method === "GET" &&
      !acceptNav.includes("application/json") &&
      !path.startsWith("/api/") &&
      !path.startsWith("/pues/") &&
      !path.startsWith("/dist/") &&
      !path.match(/\.(md|json|yaml)$/);

    if (isPageNavigation) {
      return withSelfHostedSession(req, await serveIndex());
    }

    return json({ error: "not_found", reason: "route" }, 404);
  },
};

process.on("SIGTERM", async () => {
  await closeBillingTabs();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await closeBillingTabs();
  process.exit(0);
});
