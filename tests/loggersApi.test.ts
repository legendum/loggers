import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { bootTestService, type TestService } from "pues/base/test/server";

const TEST_CONTROL_DB = "data/test-loggers-api-control.db";
const TEST_LOGGER_DIR = "data/test-loggers-api-per-ulid";
const PORT = 3042;

let svc: TestService;

beforeAll(async () => {
  if (existsSync(TEST_LOGGER_DIR)) rmSync(TEST_LOGGER_DIR, { recursive: true });
  // bootTestService sets self-hosted env + cleans the control DB; the LOGGERS_*
  // vars (per-ULID DB dir + caps) ride along via `env`, set before the import.
  svc = await bootTestService(() => import("../src/api/server"), {
    port: PORT,
    dbPath: TEST_CONTROL_DB,
    env: {
      LOGGERS_DB_DIR: TEST_LOGGER_DIR,
      LOGGERS_MAX_LOGGERS_PER_USER: "10",
    },
  });

  // Self-hosted bootstrap auto-creates a user on first request, which fires
  // `seedDefaultLoggerForNewUser`. The API tests assert against a clean slate,
  // so delete the seeded starter before they run. (selfHosted.test.ts exercises
  // the seed itself.)
  const seeded = await svc.get("/api/loggers");
  for (const row of seeded.json as { id: string }[]) {
    await svc.del(`/api/loggers/${row.id}`);
  }
});

afterAll(async () => {
  const { resetLoggerDbCacheForTesting, closeAllLoggerDbs } = await import(
    "../src/lib/loggerDb.js"
  );
  closeAllLoggerDbs();
  resetLoggerDbCacheForTesting();
  await svc.stop();
  if (existsSync(TEST_LOGGER_DIR)) rmSync(TEST_LOGGER_DIR, { recursive: true });
});

// Thin adapters over the harness client, preserving the {status, body} shape.
async function jget(path: string) {
  const r = await svc.get(path);
  return { status: r.status, body: r.json };
}

async function jpost(path: string, body: unknown) {
  const r = await svc.post(path, body);
  return { status: r.status, body: r.json };
}

async function jpatch(path: string, body: unknown) {
  const r = await svc.patch(path, body);
  return { status: r.status, body: r.json };
}

async function jdelete(path: string) {
  const r = await svc.del(path);
  return { status: r.status, body: r.json };
}

type LoggerRow = {
  id: string;
  label: string;
  slug: string;
  position: number;
};

async function listLoggers(): Promise<LoggerRow[]> {
  const r = await jget("/api/loggers");
  return r.body as LoggerRow[];
}

describe("Loggers API — pues mountResource", () => {
  test("GET /api/loggers starts empty", async () => {
    const loggers = await listLoggers();
    expect(loggers).toEqual([]);
  });

  test("POST /api/loggers { label } creates logger with slug and ulid id", async () => {
    const { status, body } = await jpost("/api/loggers", {
      label: "API Server",
    });
    expect(status).toBe(201);
    expect(body.label).toBe("API Server");
    expect(body.slug).toBe("api-server");
    expect(body.id).toMatch(/^[0-9A-Z]{26}$/);

    const { loggerDbPath } = await import("../src/lib/loggerDb.js");
    expect(existsSync(loggerDbPath(body.id))).toBe(true);
  });

  test("POST /api/loggers rejects duplicate slug", async () => {
    const loggers = await listLoggers();
    const { status } = await jpost("/api/loggers", {
      label: loggers[0]?.label,
    });
    expect(status).toBe(409);
  });

  test("GET /api/loggers/level-counts after ingest", async () => {
    const loggers = await listLoggers();
    const ulid = loggers[0]?.id as string;

    const { getLoggerDb } = await import("../src/lib/loggerDb.js");
    const db = getLoggerDb(ulid);
    const now = Date.now();
    db.run(
      `INSERT INTO logger (logged_at, level, component, data, meta)
       VALUES (?, 'error', 'test', '{}', '{}')`,
      [now],
    );
    db.run(
      `INSERT INTO logger (logged_at, level, component, data, meta)
       VALUES (?, 'info', 'test', '{}', '{}')`,
      [now + 1],
    );

    const counts = await jget("/api/loggers/level-counts");
    expect(counts.status).toBe(200);
    const rows = counts.body as {
      parent_id: string;
      value: string;
      n: number;
    }[];
    expect(
      rows.find((r) => r.parent_id === ulid && r.value === "error")?.n,
    ).toBe(1);
    expect(
      rows.find((r) => r.parent_id === ulid && r.value === "info")?.n,
    ).toBe(1);
  });

  test("PATCH /api/loggers/:ulid renames", async () => {
    const loggers = await listLoggers();
    const id = loggers[0]?.id as string;
    const { status, body } = await jpatch(`/api/loggers/${id}`, {
      label: "Renamed",
    });
    expect(status).toBe(200);
    expect(body.label).toBe("Renamed");
    expect(body.slug).toBe("renamed");
  });

  test("PATCH /api/loggers/:id {after} reorders rows", async () => {
    await jpost("/api/loggers", { label: "Second" });
    let loggers = await listLoggers();
    expect(loggers.length).toBe(2);
    const first = loggers[0]!;
    const second = loggers[1]!;

    const { status } = await jpatch(`/api/loggers/${second.id}`, {
      after: first.id,
    });
    expect(status).toBe(200);

    loggers = await listLoggers();
    expect(loggers[0]?.id).toBe(first.id);
    expect(loggers[1]?.id).toBe(second.id);
    expect(loggers[0]?.position).toBeLessThan(loggers[1]?.position ?? 0);
  });

  test("DELETE /api/loggers/:ulid removes row and db file", async () => {
    const loggers = await listLoggers();
    const row = loggers[0]!;
    const { loggerDbPath } = await import("../src/lib/loggerDb.js");
    const path = loggerDbPath(row.id);

    const { status } = await jdelete(`/api/loggers/${row.id}`);
    expect(status).toBe(204);
    expect(existsSync(path)).toBe(false);
    expect((await listLoggers()).length).toBe(1);
  });
});
