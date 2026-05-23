import { join, resolve } from "node:path";
import {
  configureAuth,
  mountAuthRoutes,
  mountLegendum,
  mountUserSettings,
  resolveUser,
  withSelfHostedSession,
} from "pues/base/auth/server";
import { isSelfHosted, ulid } from "pues/base/core";
import { getDb } from "pues/base/db/server";
import {
  type BeforeDeleteContext,
  loadPuesConfig,
  mountResource,
} from "pues/base/objects";
import { mountPwaRoutes } from "pues/base/pwa/server";
import { Loggers } from "../../public/loggers.js";
import { chargeLoggerCreate, closeBillingTabs } from "../lib/billing.js";
import { maxLoggersPerUser, PORT } from "../lib/constants.js";
import {
  closeAllLoggerDbs,
  deleteLoggerDb,
  provisionLoggerDb,
} from "../lib/loggerDb.js";
import { purgeExpiredLogs } from "../lib/loggerRetention.js";
import { toSlug, validateLoggerName } from "../lib/loggers.js";
import { listLevelCountRows } from "../lib/loggersWire.js";
import { seedDefaultLoggerForNewUser } from "../lib/seed-default-logger.js";
import * as eventsApi from "./handlers/eventsApi.js";
import * as ingestApi from "./handlers/ingestApi.js";
import * as queryApi from "./handlers/queryApi.js";
import { json } from "./json.js";
import { puesSse } from "./puesSse.js";

const root = resolve(import.meta.dir, "../..");
const requestLogger = Loggers.create({
  name: "loggers.dev",
  component: "web",
  local: true,
});

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

function errorStack(err: unknown): string | null {
  if (err instanceof Error && typeof err.stack === "string") return err.stack;
  if (
    typeof err === "object" &&
    err !== null &&
    "stack" in err &&
    typeof (err as { stack: unknown }).stack === "string"
  ) {
    return (err as { stack: string }).stack;
  }
  return null;
}

function logServerError(
  kind: "request_error" | "uncaught_exception" | "unhandled_rejection",
  err: unknown,
  req?: Request,
): void {
  const message = errorMessage(err);
  const stack = errorStack(err);
  const data: Record<string, unknown> = {
    kind,
    message,
    occurred_at: new Date().toISOString(),
  };
  if (stack) data.stack = stack;
  if (req) {
    data.method = req.method;
    data.url = req.url;
  }
  try {
    requestLogger.error(data, "web.error");
  } catch {
    // Error reporting should not throw into request/process flow.
  }
}

// The request logger writes its own access logs to LOGGERS_ULID via the
// SDK, which POSTs to /logger/<LOGGERS_ULID>/ingest|batch. Logging *those*
// requests would recurse (logging-the-logging). Skip only the self-ingest
// writes — every other /logger/ call (other loggers, and reads of this
// one) still logs, and a single self-ingest per logged request terminates
// the chain because that ingest itself isn't logged.
const SELF_LOGGER_ULID = (process.env.LOGGERS_ULID ?? "").trim();
const SELF_INGEST_RE = SELF_LOGGER_ULID
  ? new RegExp(`^/logger/${SELF_LOGGER_ULID}/(ingest|batch)$`, "i")
  : null;

function logWebRequest(
  req: Request,
  path: string,
  status: number,
  durationMs: number,
): void {
  if (SELF_INGEST_RE?.test(path)) return;
  const payload = {
    method: req.method,
    path,
    status,
    duration_ms: durationMs,
  };
  try {
    if (status >= 500) {
      requestLogger.error(payload, "web.request");
      return;
    }
    if (status === 404) {
      requestLogger.warn(payload, "web.request");
      return;
    }
    requestLogger.info(payload, "web.request");
  } catch {
    // Request logging must never break request handling.
  }
}

function wrapRoutesWithRequestLogs(
  routes: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [routePath, routeDef] of Object.entries(routes)) {
    if (!routeDef || typeof routeDef !== "object" || Array.isArray(routeDef)) {
      out[routePath] = routeDef;
      continue;
    }
    const nextDef: Record<string, unknown> = {};
    for (const [method, maybeHandler] of Object.entries(routeDef)) {
      if (typeof maybeHandler !== "function" || !/^[A-Z]+$/.test(method)) {
        nextDef[method] = maybeHandler;
        continue;
      }
      nextDef[method] = async (...args: unknown[]) => {
        const startedAt = Date.now();
        const req = args[0] instanceof Request ? args[0] : null;
        try {
          const outRes = await (
            maybeHandler as (...handlerArgs: unknown[]) => unknown
          )(...args);
          if (req) {
            const path = new URL(req.url).pathname;
            const status = outRes instanceof Response ? outRes.status : 200;
            logWebRequest(req, path, status, Date.now() - startedAt);
          }
          return outRes;
        } catch (err) {
          if (req) {
            const path = new URL(req.url).pathname;
            logWebRequest(req, path, 500, Date.now() - startedAt);
          }
          throw err;
        }
      };
    }
    out[routePath] = nextDef;
  }
  return out;
}

/** Find the content-hashed JS bundle from `public/dist`, cached after first hit. */
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
    /* no dist yet */
  }
  return null;
}

/** Send a static file with the given content-type. 404 if missing. */
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
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
    ...(extraHeaders ?? {}),
  };
  return new Response(file, { headers });
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
configureAuth({ getDb, onNewUser: seedDefaultLoggerForNewUser });

// --- pues PWA routes (`base/pwa/`) ---
const pwa = await mountPwaRoutes({ root });

// --- pues role-mapped resource: loggers ---
// Mirrors the fifos pattern: slug derivation, name validation, per-user
// count cap, and credit billing all run in the beforeInsert/beforeUpdate
// hooks. Per-logger SQLite files are provisioned eagerly inside `newId`
// (see below), so a successful POST guarantees the .db file exists.
// On delete, drop the per-logger DB file alongside the row.
const puesConfig = await loadPuesConfig();
const loggersCfg = puesConfig.objects?.resources?.loggers;
if (!loggersCfg) {
  throw new Error("config/pues.yaml: `objects.resources.loggers` is required.");
}

function rejectJson(status: number, code: string, message: string): Response {
  return json({ error: code, message }, status);
}

const puesLoggersRoutes = mountResource({
  db: getDb,
  name: "loggers",
  config: loggersCfg,
  resolveUser,
  broadcast: puesSse.broadcast,
  // Eager per-logger DB provisioning: pues calls this after beforeInsert
  // succeeds but before the INSERT, so a failed charge/validation won't
  // create an orphan .db file. The only way to leak one is a UNIQUE
  // constraint failure on the INSERT itself, which is astronomically
  // unlikely for ULIDs (80 random bits) and only catastrophic for slugs
  // (already checked in beforeInsert).
  newId: () => {
    const id = ulid();
    provisionLoggerDb(id);
    return id;
  },
  beforeInsert: async ({ body, userId }) => {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const nameError = validateLoggerName(label);
    if (nameError) return rejectJson(400, "invalid_request", nameError);

    const slug = toSlug(label);
    const db = getDb();
    const dup = db
      .query("SELECT 1 FROM loggers WHERE user_id = ? AND slug = ?")
      .get(userId, slug);
    if (dup) {
      return rejectJson(
        400,
        "invalid_request",
        `A logger with URL "${slug}" already exists`,
      );
    }

    const countRow = db
      .query("SELECT COUNT(*) AS n FROM loggers WHERE user_id = ?")
      .get(userId) as { n: number };
    if (countRow.n >= maxLoggersPerUser()) {
      return rejectJson(
        403,
        "forbidden",
        `Logger limit reached (${maxLoggersPerUser()} per account)`,
      );
    }

    const chargeError = await chargeLoggerCreate(userId);
    if (chargeError) return chargeError;

    return { ...body, label, slug };
  },
  beforeUpdate: ({ body, existing, userId }) => {
    if (typeof body.label !== "string") return body;
    const trimmed = body.label.trim();
    if (trimmed === "" || trimmed === existing.label) return body;

    const nameError = validateLoggerName(trimmed);
    if (nameError) return rejectJson(400, "invalid_request", nameError);

    const newSlug = toSlug(trimmed);
    if (newSlug === existing.slug) return body;

    const db = getDb();
    const conflict = db
      .query(
        "SELECT 1 FROM loggers WHERE user_id = ? AND slug = ? AND ulid != ?",
      )
      .get(userId, newSlug, existing.id);
    if (conflict) {
      return rejectJson(
        400,
        "invalid_request",
        `A logger with URL "${newSlug}" already exists`,
      );
    }
    return { ...body, label: trimmed, slug: newSlug };
  },
  beforeDelete: ({ existing }: BeforeDeleteContext) => {
    // pues passes the wire shape to beforeDelete, where `id` IS the ULID
    // (public_id_value), not the integer PK. See pues/base/objects/wire.ts.
    deleteLoggerDb(String(existing.id));
  },
});

const loggerApiCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Resolve `/logger/:ulid/<verb>` routes. Returns null when the path
 * doesn't match a registered verb so the caller can fall through to 404.
 */
async function routeLoggerPublicApi(
  req: Request,
  path: string,
  method: string,
): Promise<Response | null> {
  const m = path.match(
    /^\/logger\/([0-7][0-9A-HJKMNP-TV-Z]{25})\/(ingest|batch|logs|search|events)$/i,
  );
  if (!m) return null;
  const [, ulid, verb] = m;
  const id = ulid.toUpperCase();

  if (method === "POST" && verb === "ingest")
    return ingestApi.postIngest(req, id);
  if (method === "POST" && verb === "batch")
    return ingestApi.postBatch(req, id);
  if (method === "GET" && verb === "logs") return queryApi.getLogs(req, id);
  if (method === "GET" && verb === "search") return queryApi.getSearch(req, id);
  if (method === "GET" && verb === "events")
    return eventsApi.getEvents(req, id);

  return null;
}

export default {
  port: PORT,
  development: !!process.env.DEV,
  // SSE streams must outlive Bun's 10s default. 255 is the max.
  idleTimeout: 255,
  routes: wrapRoutesWithRequestLogs({
    ...mountAuthRoutes(),
    ...mountLegendum(),
    ...mountUserSettings(),
    ...pwa.routes,
    ...puesLoggersRoutes,
    ...puesSse.routes,
    "/api/health": {
      GET: () => json({ ok: true }),
    },
    "/api/mode": {
      GET: () => json({ self_hosted: isSelfHosted() }),
    },
    "/api/loggers/level-counts": {
      GET: async (req: Request) => {
        const userId = await resolveUser(req);
        if (userId === null) {
          return json(
            { error: "unauthorized", message: "Sign in required" },
            401,
          );
        }
        const tz = new URL(req.url).searchParams.get("tz") ?? "UTC";
        return json(listLevelCountRows(userId, tz));
      },
    },
  }),
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const startedAt = Date.now();
    const done = (res: Response): Response => {
      logWebRequest(req, path, res.status, Date.now() - startedAt);
      return res;
    };

    try {
      if (method === "OPTIONS" && path.startsWith("/logger/")) {
        return done(
          new Response(null, { status: 204, headers: loggerApiCorsHeaders }),
        );
      }

      // pues PWA: workbox-* runtime chunks (hash-named, so wildcard not literal).
      const pwaHit = await pwa.fetch(req);
      if (pwaHit) return done(pwaHit);

      // --- Static frontend assets (no auth, no user resolution). ---
      if (method === "GET") {
        if (path === "/main.css") {
          return done(
            await serveStatic(join(root, "src/web/main.css"), "text/css"),
          );
        }
        if (path === "/loggers.js") {
          return done(
            await serveStatic(
              join(root, "public/loggers.js"),
              "application/javascript",
              "public, max-age=300",
            ),
          );
        }
        if (path === "/install.sh") {
          return done(
            await serveStatic(
              join(root, "public/install.sh"),
              "text/plain; charset=utf-8",
              "public, max-age=300",
            ),
          );
        }
        if (path === "/dist/pues.css") {
          return done(
            await serveStatic(join(root, "public/dist/pues.css"), "text/css"),
          );
        }
        if (path === "/loggers.png") {
          return done(
            await serveStatic(join(root, "public/loggers.png"), "image/png"),
          );
        }
        if (path.startsWith("/dist/")) {
          const safe = path.replace(/\.\./g, "");
          return done(
            await serveStatic(
              join(root, "public", safe),
              "application/javascript",
              "public, max-age=31536000, immutable",
            ),
          );
        }
      }

      // --- Public logger API routes (no auth — ULID is the credential). ---
      if (path.startsWith("/logger/")) {
        const res = await routeLoggerPublicApi(req, path, method);
        if (res) {
          for (const [k, v] of Object.entries(loggerApiCorsHeaders)) {
            res.headers.set(k, v);
          }
          return done(res);
        }
      }

      // Browser GETs that are not API-shaped get the SPA shell.
      const acceptNav = req.headers.get("Accept") ?? "";
      const isPageNavigation =
        method === "GET" &&
        !acceptNav.includes("application/json") &&
        !path.startsWith("/api/") &&
        !path.startsWith("/logger/") &&
        !path.startsWith("/pues/") &&
        !path.startsWith("/dist/") &&
        !path.match(/\.(md|json|yaml)$/);

      if (isPageNavigation) {
        return done(withSelfHostedSession(req, await serveIndex()));
      }

      return done(json({ error: "not_found", reason: "route" }, 404));
    } catch (err) {
      logServerError("request_error", err, req);
      return done(json({ error: "internal_error", reason: "server" }, 500));
    }
  },
};

// --- Log retention sweep ---
// Per-logger tables grow unbounded otherwise. Delete rows past the fixed
// 7×24h window on a slow cadence (hourly), decoupled from ingest — never on
// the write path. The first pass is delayed so it can't compete with
// startup, and both timers are unref'd so they don't keep the process (or
// tests) alive.
const RETENTION_SWEEP_MS = 60 * 60 * 1000;
const RETENTION_FIRST_DELAY_MS = 5 * 60 * 1000;

function runRetentionSweep(): void {
  try {
    const { loggers, deleted } = purgeExpiredLogs();
    if (deleted > 0) {
      requestLogger.info({ loggers, deleted }, "retention.sweep");
    }
  } catch (err) {
    logServerError("request_error", err);
  }
}

const retentionKickoff = setTimeout(
  runRetentionSweep,
  RETENTION_FIRST_DELAY_MS,
);
const retentionTimer = setInterval(runRetentionSweep, RETENTION_SWEEP_MS);
retentionKickoff.unref();
retentionTimer.unref();

async function shutdown(): Promise<void> {
  clearTimeout(retentionKickoff);
  clearInterval(retentionTimer);
  closeAllLoggerDbs();
  await closeBillingTabs();
  await requestLogger.close();
}

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});
process.on("unhandledRejection", (reason) => {
  logServerError("unhandled_rejection", reason);
});
process.on("uncaughtException", (err) => {
  logServerError("uncaught_exception", err);
  void requestLogger.flush().finally(() => process.exit(1));
});
