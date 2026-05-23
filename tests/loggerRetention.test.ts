import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";

process.env.LOGGERS_DB_DIR = "data/test-retention-per-ulid";
const TEST_DIR = process.env.LOGGERS_DB_DIR as string;
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

beforeAll(() => {
  mkdirSync("data", { recursive: true });
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  const { closeAllLoggerDbs, resetLoggerDbCacheForTesting } = await import(
    "../src/lib/loggerDb.js"
  );
  closeAllLoggerDbs();
  resetLoggerDbCacheForTesting();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("db log retention", () => {
  test("purges rows older than 7×24h, keeps recent ones", async () => {
    const { getLoggerDb, provisionLoggerDb } = await import(
      "../src/lib/loggerDb.js"
    );
    const { purgeExpiredLogs, DB_RETENTION_MS } = await import(
      "../src/lib/loggerRetention.js"
    );

    provisionLoggerDb(ULID);
    const db = getLoggerDb(ULID);
    const now = Date.now();
    const insert = (loggedAt: number, msg: string) =>
      db.run(
        `INSERT INTO logger (logged_at, level, component, data, meta)
         VALUES (?, 'info', 'test', ?, '{}')`,
        [loggedAt, JSON.stringify({ msg })],
      );

    insert(now - DB_RETENTION_MS - 60_000, "expired"); // just past the window
    insert(now - DB_RETENTION_MS + 60_000, "inside"); // just inside it
    insert(now - 1_000, "fresh");

    const summary = purgeExpiredLogs(now);
    expect(summary.deleted).toBe(1);
    expect(summary.loggers).toBe(1);

    const remaining = db
      .query("SELECT data FROM logger ORDER BY logged_at ASC")
      .all() as { data: string }[];
    expect(remaining).toHaveLength(2);
    expect(remaining.map((r) => r.data).join()).not.toContain("expired");
    expect(remaining.map((r) => r.data).join()).toContain("inside");
    expect(remaining.map((r) => r.data).join()).toContain("fresh");
  });
});
