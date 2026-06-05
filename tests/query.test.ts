import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { bootTestService, type TestService } from "pues/base/test/server";

const TEST_CONTROL_DB = "data/test-query-control.db";
const TEST_LOGGER_DIR = "data/test-query-per-ulid";
const PORT = 3044;

let svc: TestService;
let base: string;
let loggerUlid: string;

beforeAll(async () => {
  if (existsSync(TEST_LOGGER_DIR)) rmSync(TEST_LOGGER_DIR, { recursive: true });
  svc = await bootTestService(() => import("../src/api/server"), {
    port: PORT,
    dbPath: TEST_CONTROL_DB,
    env: { LOGGERS_DB_DIR: TEST_LOGGER_DIR },
  });
  base = svc.base;

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
        {
          level: "warn",
          component: "worker",
          data: { msg: "yesterday-line" },
          logged_at: t0 - 24 * 60 * 60 * 1000,
        },
      ],
    }),
  });
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

  test("GET /logger/:ulid/logs pages backward (newest to older)", async () => {
    const page1 = await fetch(
      `${base}/logger/${loggerUlid}/logs?window=today&dir=backward&limit=1`,
    );
    const b1 = (await page1.json()) as {
      items: { id: number; level: string }[];
      next_cursor: string;
    };
    expect(b1.items).toHaveLength(1);
    expect(b1.items[0]?.level).toBe("error");
    expect(b1.next_cursor).toBeTruthy();

    const page2 = await fetch(
      `${base}/logger/${loggerUlid}/logs?window=today&dir=backward&limit=1&cursor=${encodeURIComponent(b1.next_cursor)}`,
    );
    const b2 = (await page2.json()) as { items: { level: string }[] };
    expect(b2.items).toHaveLength(1);
    expect(b2.items[0]?.level).toBe("info");
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

  test("GET /logger/:ulid/counts scopes by selected window", async () => {
    const today = await fetch(
      `${base}/logger/${loggerUlid}/counts?window=today&tz=UTC`,
    );
    expect(today.status).toBe(200);
    const todayBody = (await today.json()) as {
      debug: number;
      info: number;
      warn: number;
      error: number;
    };
    expect(todayBody).toMatchObject({
      debug: 0,
      info: 1,
      warn: 0,
      error: 1,
    });

    const yesterday = await fetch(
      `${base}/logger/${loggerUlid}/counts?window=yesterday&tz=UTC`,
    );
    expect(yesterday.status).toBe(200);
    const yesterdayBody = (await yesterday.json()) as {
      debug: number;
      info: number;
      warn: number;
      error: number;
    };
    expect(yesterdayBody).toMatchObject({
      debug: 0,
      info: 0,
      warn: 1,
      error: 0,
    });
  });

  test("GET /logger/:ulid/search finds substring hits", async () => {
    const res = await fetch(
      `${base}/logger/${loggerUlid}/search?q=bravo&window=today`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { data: { msg: string } }[] };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0]?.data.msg).toContain("alpha");
  });
});

describe("Search query rewrite", () => {
  let filterUlid: string;

  beforeAll(async () => {
    const create = await fetch(`${base}/api/loggers`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Filter Test" }),
    });
    filterUlid = ((await create.json()) as { id: string }).id;

    const t0 = Date.now();
    await fetch(`${base}/logger/${filterUlid}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines: [
          // scalar status + route string + user_id scalar
          {
            level: "info",
            component: "api",
            data: { route: "POST", status: 404, user_id: 5 },
            logged_at: t0,
          },
          // string status (quoted value), different route
          {
            level: "info",
            component: "api",
            data: { route: "GET", status: "404" },
            logged_at: t0 + 1,
          },
          // route POST but status 200 — for AND semantics
          {
            level: "info",
            component: "api",
            data: { route: "POST", status: 200 },
            logged_at: t0 + 2,
          },
          // a phrase, and a key that should NOT match user_id:5
          {
            level: "info",
            component: "worker",
            data: { msg: "two words here", userXid: 5 },
            logged_at: t0 + 3,
          },
        ],
      }),
    });
  });

  const search = async (q: string) => {
    const res = await fetch(
      `${base}/logger/${filterUlid}/search?q=${encodeURIComponent(q)}&window=today`,
    );
    expect(res.status).toBe(200);
    return (
      (await res.json()) as { items: { data: Record<string, unknown> }[] }
    ).items;
  };

  test("status:404 matches both scalar and string values", async () => {
    const items = await search("status:404");
    expect(items.length).toBe(2);
  });

  test("field value is a prefix (status:40 matches 404)", async () => {
    const items = await search("status:40");
    expect(items.length).toBe(2);
  });

  test("AND semantics: route:POST status:200 requires both", async () => {
    const items = await search("route:POST status:200");
    expect(items.length).toBe(1);
    expect(items[0]?.data.status).toBe(200);
  });

  test("key boundary: user_id:5 does not match userXid:5", async () => {
    const items = await search("user_id:5");
    expect(items.length).toBe(1);
    expect(items[0]?.data.user_id).toBe(5);
  });

  test("quoted value matches phrase with spaces", async () => {
    const items = await search('msg:"two words"');
    expect(items.length).toBe(1);
    expect(items[0]?.data.msg).toBe("two words here");
  });

  test("bare phrase quoting keeps the literal", async () => {
    const items = await search('"two words"');
    expect(items.length).toBe(1);
  });
});
