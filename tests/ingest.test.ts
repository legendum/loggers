import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";

process.env.PUES_DB_PATH = "data/test-ingest-control.db";
process.env.LOGGERS_DB_DIR = "data/test-ingest-per-ulid";
process.env.LOGGERS_MAX_BATCH = "10";

const TEST_CONTROL_DB = process.env.PUES_DB_PATH as string;
const TEST_LOGGER_DIR = process.env.LOGGERS_DB_DIR as string;
const PORT = 3043;

let server: { stop: () => void } | undefined;
let base: string;
let loggerUlid: string;

beforeAll(async () => {
  delete process.env.LEGENDUM_API_KEY;
  delete process.env.LEGENDUM_SECRET;
  mkdirSync("data", { recursive: true });
  if (existsSync(TEST_CONTROL_DB)) rmSync(TEST_CONTROL_DB);
  if (existsSync(TEST_LOGGER_DIR)) rmSync(TEST_LOGGER_DIR, { recursive: true });

  const mod = await import("../src/api/server");
  server = Bun.serve({ ...mod.default, port: PORT });
  base = `http://localhost:${PORT}`;

  const create = await fetch(`${base}/api/loggers`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "Ingest Test" }),
  });
  const body = (await create.json()) as { id: string };
  loggerUlid = body.id;
});

afterAll(async () => {
  server?.stop();
  const { resetDbForTesting } = await import("pues/base/db/server");
  const { resetLoggerDbCacheForTesting, closeAllLoggerDbs } = await import(
    "../src/lib/loggerDb.js"
  );
  closeAllLoggerDbs();
  resetLoggerDbCacheForTesting();
  resetDbForTesting();
  if (existsSync(TEST_CONTROL_DB)) rmSync(TEST_CONTROL_DB);
  if (existsSync(TEST_LOGGER_DIR)) rmSync(TEST_LOGGER_DIR, { recursive: true });
});

async function ingest(line: Record<string, unknown>) {
  const res = await fetch(`${base}/logger/${loggerUlid}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(line),
  });
  return { status: res.status, body: await res.json() };
}

async function batch(lines: Record<string, unknown>[]) {
  const res = await fetch(`${base}/logger/${loggerUlid}/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines }),
  });
  return { status: res.status, body: await res.json() };
}

describe("Ingest API", () => {
  test("POST /logger/:ulid/ingest accepts a valid line", async () => {
    const loggedAt = Date.now();
    const { status, body } = await ingest({
      level: "info",
      component: "api",
      data: { msg: "hello", request_id: "req-1" },
      logged_at: loggedAt,
    });
    expect(status).toBe(201);
    expect(body.level).toBe("info");
    expect(body.component).toBe("api");
    expect(body.logged_at).toBe(loggedAt);
    expect(body.data.msg).toBe("hello");
    expect(body.data.request_id).toBe("req-1");
    expect(body.meta.request_id).toBeUndefined();
    expect(body.meta.component).toBe("api");
    expect(typeof body.id).toBe("number");
  });

  test("POST /logger/:ulid/ingest redacts sensitive keys into meta", async () => {
    const { body } = await ingest({
      level: "warn",
      component: "auth",
      data: { password: "secret", token: "abc" },
      logged_at: Date.now(),
    });
    expect(body.meta.redactions).toContain("password");
    expect(body.meta.redactions).toContain("token");
    expect(body.data.password).toBe("secret");
  });

  test("POST /logger/:ulid/ingest rejects invalid level", async () => {
    const { status, body } = await ingest({
      level: "trace",
      component: "api",
      data: {},
      logged_at: Date.now(),
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("POST /logger/:ulid/ingest rejects missing component", async () => {
    const { status } = await ingest({
      level: "info",
      component: "  ",
      data: {},
      logged_at: Date.now(),
    });
    expect(status).toBe(400);
  });

  test("POST /logger/:ulid/batch ingests multiple lines", async () => {
    const t = Date.now();
    const { status, body } = await batch([
      { level: "debug", component: "worker", data: { n: 1 }, logged_at: t },
      { level: "error", component: "worker", data: { n: 2 }, logged_at: t + 1 },
    ]);
    expect(status).toBe(201);
    expect(body.accepted).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  test("GET /api/loggers/level-counts reflects ingested levels", async () => {
    const res = await fetch(`${base}/api/loggers/level-counts`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const rows = (await res.json()) as {
      parent_id: string;
      value: string;
      n: number;
    }[];
    const forLogger = rows.filter((r) => r.parent_id === loggerUlid);
    expect(forLogger.find((r) => r.value === "info")?.n).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      forLogger.find((r) => r.value === "error")?.n,
    ).toBeGreaterThanOrEqual(1);
    expect(forLogger.find((r) => r.value === "warn")?.n).toBeGreaterThanOrEqual(
      1,
    );
  });

  test("unknown ulid returns 404", async () => {
    const res = await fetch(
      `${base}/logger/01ARZ3NDEKTSV4RRFFQ69G5ZZZ/ingest`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: "info",
          component: "x",
          data: {},
          logged_at: Date.now(),
        }),
      },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.reason).toBe("ulid");
  });
});
