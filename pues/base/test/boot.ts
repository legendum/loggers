/**
 * `bootTestService` — stand up a Pues service in self-hosted mode against a
 * throwaway SQLite DB, for integration tests.
 *
 * The recurring shape every consumer hand-rolls: point `PUES_DB_PATH` at a temp
 * file, unset the Legendum creds (so `resolveUser` mints a local user and billing
 * is skipped), import the consumer's server module *after* that env is set (so its
 * first `getDb()` picks up the temp DB), `Bun.serve` it, and tear it all down. The
 * import-after-env ordering is the subtle bit — pass a thunk, not an already-
 * imported module, so the harness controls when the module's top-level `getDb()`
 * runs. Schema/migrations are applied automatically by `base/db`'s `getDb()`, so
 * the harness does nothing about them.
 *
 *   import { bootTestService } from "pues/base/test/server";
 *
 *   const svc = await bootTestService(() => import("../src/api/server"));
 *   const r = await svc.post("/api/things", { name: "x" });
 *   expect(r.status).toBe(201);
 *   await svc.stop();
 *
 * Consumer-specific seeding (a known user, key, or fixture row) stays in the
 * consumer — compose it after boot, using `getDb()` or your own `ensure*` helpers.
 */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";

export type JsonResult = { status: number; json: any };

export type TestService = {
  /** Origin the service is served at, e.g. `http://localhost:3412`. */
  base: string;
  /** Fetch `path`, JSON-encoding `body` when present; returns status + parsed JSON. */
  fetchJson: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<JsonResult>;
  /** `GET path` → `{ status, json }`. */
  get: (path: string) => Promise<JsonResult>;
  /** `POST path` with JSON `body`. */
  post: (path: string, body?: unknown) => Promise<JsonResult>;
  /** `PATCH path` with JSON `body`. */
  patch: (path: string, body?: unknown) => Promise<JsonResult>;
  /** `DELETE path` (optional JSON `body`). */
  del: (path: string, body?: unknown) => Promise<JsonResult>;
  /** Stop the server, reset the shared DB handle, and delete the temp DB file. */
  stop: () => Promise<void>;
};

/** The shape `bootTestService` needs from a consumer's server module: a default
 *  export suitable for `Bun.serve` (a `{ fetch, routes?, ... }` object). */
type ServerModule = { default: Bun.ServeOptions };

export type BootOptions = {
  /** Fixed port (else a random high port, to avoid cross-file collisions). */
  port?: number;
  /** Temp DB path (else `data/test-<port>.db`). Deleted on `stop()`. */
  dbPath?: string;
  /** Extra env vars set BEFORE the server import — for consumer caps/flags the
   *  module reads at load time (e.g. `{ FIFOS_MAX_ITEMS_PER_FIFO: "5" }`). */
  env?: Record<string, string>;
};

export async function bootTestService(
  importServer: () => Promise<ServerModule>,
  opts: BootOptions = {},
): Promise<TestService> {
  const port = opts.port ?? 3060 + Math.floor(Math.random() * 800);
  const dbPath = opts.dbPath ?? `data/test-${port}.db`;

  // Self-hosted: a local user, no billing. MUST be set before the server import,
  // since the module's top-level `getDb()` reads PUES_DB_PATH on first call.
  process.env.PUES_DB_PATH = dbPath;
  delete process.env.LEGENDUM_API_KEY;
  delete process.env.LEGENDUM_SECRET;
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) process.env[k] = v;
  }

  mkdirSync("data", { recursive: true });
  if (existsSync(dbPath)) unlinkSync(dbPath);

  const mod = await importServer();
  const server = Bun.serve({ ...mod.default, port } as Bun.ServeOptions);
  const base = `http://localhost:${port}`;

  const fetchJson = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<JsonResult> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!text) return { status: res.status, json: null };
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      throw new Error(
        `bootTestService: non-JSON response from ${method} ${path} ` +
          `(status ${res.status}): ${text.slice(0, 200)}`,
      );
    }
  };

  const stop = async (): Promise<void> => {
    server.stop();
    const { resetDbForTesting } = await import("../db/server");
    resetDbForTesting();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  };

  return {
    base,
    fetchJson,
    get: (path) => fetchJson("GET", path),
    post: (path, body) => fetchJson("POST", path, body),
    patch: (path, body) => fetchJson("PATCH", path, body),
    del: (path, body) => fetchJson("DELETE", path, body),
    stop,
  };
}
