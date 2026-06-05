import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { bootTestService, type TestService } from "pues/base/test/server";

const TEST_CONTROL_DB = "data/test-self-hosted-control.db";
const TEST_LOGGER_DIR = "data/test-self-hosted-per-ulid";
const PORT = 3045;

let svc: TestService;
let base: string;

beforeAll(async () => {
  if (existsSync(TEST_LOGGER_DIR)) rmSync(TEST_LOGGER_DIR, { recursive: true });
  svc = await bootTestService(() => import("../src/api/server"), {
    port: PORT,
    dbPath: TEST_CONTROL_DB,
    env: { LOGGERS_DB_DIR: TEST_LOGGER_DIR },
  });
  base = svc.base;
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

describe("self-hosted mode", () => {
  test("GET /api/mode reports self_hosted", async () => {
    const res = await fetch(`${base}/api/mode`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { self_hosted: boolean }).self_hosted).toBe(
      true,
    );
  });

  test("GET / then /pues/me returns local user", async () => {
    const home = await fetch(`${base}/`, {
      headers: { Accept: "text/html" },
    });
    const setCookie = home.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/pues_session=/);

    const cookie = setCookie.match(/pues_session=[^;]+/)?.[0] ?? "";
    const me = await fetch(`${base}/pues/me`, {
      headers: { Accept: "application/json", Cookie: cookie },
    });
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      hosted: boolean;
      legendum_linked: boolean;
    };
    expect(body.hosted).toBe(false);
    expect(body.legendum_linked).toBe(false);
  });

  test("GET /api/loggers returns seeded starter logger", async () => {
    const home = await fetch(`${base}/`, { headers: { Accept: "text/html" } });
    const cookie =
      home.headers.get("set-cookie")?.match(/pues_session=[^;]+/)?.[0] ?? "";

    const res = await fetch(`${base}/api/loggers`, {
      headers: { Accept: "application/json", Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { label: string; slug: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.slug).toBe("my-first-logger");
  });
});
