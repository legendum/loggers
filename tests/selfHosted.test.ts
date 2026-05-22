import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";

process.env.PUES_DB_PATH = "data/test-self-hosted-control.db";
process.env.LOGGERS_DB_DIR = "data/test-self-hosted-per-ulid";
delete process.env.LEGENDUM_API_KEY;
delete process.env.LEGENDUM_SECRET;

const TEST_CONTROL_DB = process.env.PUES_DB_PATH as string;
const TEST_LOGGER_DIR = process.env.LOGGERS_DB_DIR as string;
const PORT = 3045;

let server: { stop: () => void } | undefined;
let base: string;

beforeAll(async () => {
  mkdirSync("data", { recursive: true });
  if (existsSync(TEST_CONTROL_DB)) rmSync(TEST_CONTROL_DB);
  if (existsSync(TEST_LOGGER_DIR)) rmSync(TEST_LOGGER_DIR, { recursive: true });

  const mod = await import("../src/api/server");
  server = Bun.serve({ ...mod.default, port: PORT });
  base = `http://localhost:${PORT}`;
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
