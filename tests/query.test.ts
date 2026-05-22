import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";

process.env.PUES_DB_PATH = "data/test-query-control.db";
process.env.LOGGERS_DB_DIR = "data/test-query-per-ulid";
const PORT = 3044;

let server: { stop: () => void } | undefined;
let base: string;
let loggerUlid: string;

beforeAll(async () => {
  delete process.env.LEGENDUM_API_KEY;
  mkdirSync("data", { recursive: true });
  if (existsSync(process.env.PUES_DB_PATH as string)) {
    rmSync(process.env.PUES_DB_PATH as string);
  }
  if (existsSync(process.env.LOGGERS_DB_DIR as string)) {
    rmSync(process.env.LOGGERS_DB_DIR as string, { recursive: true });
  }

  const mod = await import("../src/api/server");
  server = Bun.serve({ ...mod.default, port: PORT });
  base = `http://localhost:${PORT}`;

  const create = await fetch(`${base}/api/loggers`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "Query Test" }),
  });
  loggerUlid = ((await create.json()) as { id: string }).id;

  const t0 = Date.now();
  await fetch(`${base}/logger/${loggerUlid}/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lines: [
        {
          level: "info",
          component: "api",
          data: { msg: "alpha bravo", request_id: "r1" },
          logged_at: t0,
        },
        {
          level: "error",
          component: "worker",
          data: { msg: "charlie" },
          logged_at: t0 + 1,
        },
      ],
    }),
  });
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
});

describe("Query API", () => {
  test("GET /logger/:ulid/logs returns chronological items", async () => {
    const res = await fetch(
      `${base}/logger/${loggerUlid}/logs?window=today&limit=100`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { logged_at: number; level: string }[];
      next_cursor: string | null;
    };
    expect(body.items.length).toBe(2);
    expect(body.items[0]?.level).toBe("info");
    expect(body.items[1]?.level).toBe("error");
    expect(body.items[0]!.logged_at).toBeLessThanOrEqual(
      body.items[1]!.logged_at,
    );
    expect(body.next_cursor).toBeNull();
  });

  test("GET /logger/:ulid/logs filters by level", async () => {
    const res = await fetch(
      `${base}/logger/${loggerUlid}/logs?window=today&level=error`,
    );
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  test("GET /logger/:ulid/logs pages with cursor", async () => {
    const page1 = await fetch(
      `${base}/logger/${loggerUlid}/logs?window=today&limit=1`,
    );
    const b1 = (await page1.json()) as {
      items: { id: number }[];
      next_cursor: string;
    };
    expect(b1.items).toHaveLength(1);
    expect(b1.next_cursor).toBeTruthy();

    const page2 = await fetch(
      `${base}/logger/${loggerUlid}/logs?window=today&limit=1&cursor=${encodeURIComponent(b1.next_cursor)}`,
    );
    const b2 = (await page2.json()) as { items: { id: number }[] };
    expect(b2.items).toHaveLength(1);
    expect(b2.items[0]?.id).not.toBe(b1.items[0]?.id);
  });

  test("GET /logger/:ulid/search finds FTS hits", async () => {
    const res = await fetch(
      `${base}/logger/${loggerUlid}/search?q=bravo&window=today`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { data: { msg: string } }[] };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0]?.data.msg).toContain("alpha");
  });
});
