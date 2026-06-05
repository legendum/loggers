import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createTempDb, type TempDb } from "pues/base/test/server";

const TEST_ULID_A = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const TEST_ULID_B = "01ARZ3NDEKTSV4RRFFQ69G5FBW";
const TEST_ULID_C = "01ARZ3NDEKTSV4RRFFQ69G5FCX";
const TEST_CONTROL_DB = "data/test-loggers-control.db";
const TEST_LOGGER_DIR = "data/test-loggers-per-ulid";

let tdb: TempDb;

beforeAll(() => {
  if (existsSync(TEST_LOGGER_DIR)) rmSync(TEST_LOGGER_DIR, { recursive: true });
  tdb = createTempDb({
    dbPath: TEST_CONTROL_DB,
    env: {
      LOGGERS_DB_DIR: TEST_LOGGER_DIR,
      LOGGERS_MAX_OPEN_DBS: "2",
      LOGGERS_DB_IDLE_MS: "60000",
    },
  });
});

beforeEach(async () => {
  const { resetLoggerDbCacheForTesting } = await import(
    "../src/lib/loggerDb.js"
  );
  resetLoggerDbCacheForTesting();
});

afterAll(async () => {
  const { resetLoggerDbCacheForTesting, closeAllLoggerDbs } = await import(
    "../src/lib/loggerDb.js"
  );
  closeAllLoggerDbs();
  resetLoggerDbCacheForTesting();
  tdb.stop();
  if (existsSync(TEST_LOGGER_DIR)) rmSync(TEST_LOGGER_DIR, { recursive: true });
});

describe("control db schema", () => {
  test("getDb creates users and loggers tables", async () => {
    const { getDb } = await import("pues/base/db/server");
    const db = getDb();
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("users");
    expect(names).toContain("loggers");
    expect(names).toContain("logger");
    expect(names).not.toContain("logger_fts");
  });
});

describe("per-logger db", () => {
  test("provision creates file and accepts inserts", async () => {
    const { provisionLoggerDb, getLoggerDb, loggerDbPath } = await import(
      "../src/lib/loggerDb.js"
    );
    provisionLoggerDb(TEST_ULID_A);
    expect(existsSync(loggerDbPath(TEST_ULID_A))).toBe(true);

    const db = getLoggerDb(TEST_ULID_A);
    db.run(
      `INSERT INTO logger (logged_at, level, component, data, meta)
       VALUES (?, 'info', 'test', ?, '{}')`,
      [1_710_000_000_123, JSON.stringify({ msg: "hello" })],
    );
    const row = db
      .query("SELECT level, component FROM logger WHERE id = 1")
      .get() as { level: string; component: string };
    expect(row.level).toBe("info");
    expect(row.component).toBe("test");
  });

  test("delete removes db file", async () => {
    const { provisionLoggerDb, deleteLoggerDb, loggerDbPath } = await import(
      "../src/lib/loggerDb.js"
    );
    provisionLoggerDb(TEST_ULID_B);
    const path = loggerDbPath(TEST_ULID_B);
    expect(existsSync(path)).toBe(true);
    deleteLoggerDb(TEST_ULID_B);
    expect(existsSync(path)).toBe(false);
  });

  test("LRU evicts oldest open handle when over max", async () => {
    const { getLoggerDb, provisionLoggerDb, openLoggerDbCountForTesting } =
      await import("../src/lib/loggerDb.js");

    provisionLoggerDb(TEST_ULID_A);
    provisionLoggerDb(TEST_ULID_B);
    provisionLoggerDb(TEST_ULID_C);

    const dbA = getLoggerDb(TEST_ULID_A);
    getLoggerDb(TEST_ULID_B);
    getLoggerDb(TEST_ULID_C);

    expect(openLoggerDbCountForTesting()).toBe(2);
    expect(() => dbA.query("SELECT 1").get()).toThrow();
  });

  test("rejects invalid ulid", async () => {
    const { provisionLoggerDb } = await import("../src/lib/loggerDb.js");
    expect(() => provisionLoggerDb("../evil")).toThrow(/invalid logger ulid/);
  });
});
