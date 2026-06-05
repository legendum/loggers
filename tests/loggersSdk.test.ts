import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "pues/base/test/server";

import { Loggers } from "../public/loggers.js";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function dayKeyUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

describe("loggers.js name resolution behavior", () => {
  test("default level is info (debug drops)", async () => {
    const sandbox = makeTempDir("loggers-sdk-").dir;
    const home = join(sandbox, "home");
    const oldHome = process.env.HOME;
    const oldName = process.env.LOGGERS_NAME;
    const oldUlid = process.env.LOGGERS_ULID;
    try {
      mkdirSync(home, { recursive: true });
      process.env.HOME = home;
      process.env.LOGGERS_NAME = "";
      process.env.LOGGERS_ULID = "";
      const localDir = join(sandbox, "local-logs");
      const logger = Loggers.create({
        name: "orders_api",
        component: "worker",
        local: { dir: localDir, retentionDays: 7, timezone: "UTC" },
      });
      const now = Date.now();
      logger.debug({ msg: "debug should drop", now });
      logger.info({ msg: "info should keep", now });
      await logger.close();

      const path = join(localDir, "orders_api", `${dayKeyUtc(now)}.log`);
      const body = readFileSync(path, "utf-8");
      expect(body).not.toContain("debug should drop");
      expect(body).toContain("info should keep");
    } finally {
      process.env.HOME = oldHome;
      process.env.LOGGERS_NAME = oldName;
      process.env.LOGGERS_ULID = oldUlid;
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("LOGGERS_LEVEL from .env/env acts as minimum level", async () => {
    const sandbox = makeTempDir("loggers-sdk-").dir;
    const home = join(sandbox, "home");
    const oldHome = process.env.HOME;
    const oldName = process.env.LOGGERS_NAME;
    const oldUlid = process.env.LOGGERS_ULID;
    const oldLevel = process.env.LOGGERS_LEVEL;
    try {
      mkdirSync(home, { recursive: true });
      process.env.HOME = home;
      process.env.LOGGERS_NAME = "";
      process.env.LOGGERS_ULID = "";
      process.env.LOGGERS_LEVEL = "warn";
      const localDir = join(sandbox, "local-logs");
      const logger = Loggers.create({
        name: "orders_api",
        component: "worker",
        local: { dir: localDir, retentionDays: 7, timezone: "UTC" },
      });
      const now = Date.now();
      logger.info({ msg: "info should drop", now });
      logger.warn({ msg: "warn should keep", now });
      await logger.close();

      const path = join(localDir, "orders_api", `${dayKeyUtc(now)}.log`);
      const body = readFileSync(path, "utf-8");
      expect(body).not.toContain("info should drop");
      expect(body).toContain("warn should keep");
    } finally {
      process.env.HOME = oldHome;
      process.env.LOGGERS_NAME = oldName;
      process.env.LOGGERS_ULID = oldUlid;
      process.env.LOGGERS_LEVEL = oldLevel;
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("LOGGERS_NAME + LOGGERS_ULID map name to remote target", async () => {
    const sandbox = makeTempDir("loggers-sdk-").dir;
    const home = join(sandbox, "home");
    const oldHome = process.env.HOME;
    const oldName = process.env.LOGGERS_NAME;
    const oldUlid = process.env.LOGGERS_ULID;
    const oldFetch = globalThis.fetch;
    let fetchCalls = 0;
    let lastUrl = "";

    try {
      mkdirSync(home, { recursive: true });
      process.env.HOME = home;
      process.env.LOGGERS_NAME = "orders_api";
      process.env.LOGGERS_ULID = ULID;
      globalThis.fetch = (async (url: string | URL) => {
        fetchCalls += 1;
        lastUrl = String(url);
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const logger = Loggers.create({
        name: "orders_api",
        component: "worker",
      });
      logger.info({ msg: "env-mapped remote write" });
      await logger.close();

      expect(fetchCalls).toBeGreaterThanOrEqual(1);
      expect(lastUrl).toContain(`/logger/${ULID}/batch`);
    } finally {
      process.env.HOME = oldHome;
      process.env.LOGGERS_NAME = oldName;
      process.env.LOGGERS_ULID = oldUlid;
      globalThis.fetch = oldFetch;
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("missing alias skips remote writes but still writes local when enabled", async () => {
    const sandbox = makeTempDir("loggers-sdk-").dir;
    const home = join(sandbox, "home");
    const oldHome = process.env.HOME;
    const oldFetch = globalThis.fetch;
    let fetchCalls = 0;

    try {
      mkdirSync(home, { recursive: true });
      process.env.HOME = home;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response("unexpected", { status: 500 });
      }) as typeof fetch;

      const localDir = join(sandbox, "local-logs");
      const logger = Loggers.create({
        name: "orders_api",
        component: "worker",
        local: { dir: localDir, retentionDays: 7, timezone: "UTC" },
      });

      const now = Date.now();
      logger.info({ msg: "only local", now });
      await logger.flush();
      await logger.close();

      expect(fetchCalls).toBe(0);
      const path = join(localDir, "orders_api", `${dayKeyUtc(now)}.log`);
      const body = readFileSync(path, "utf-8");
      expect(body).toContain('"msg":"only local"');
    } finally {
      globalThis.fetch = oldFetch;
      process.env.HOME = oldHome;
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("name alias in config enables remote writes", async () => {
    const sandbox = makeTempDir("loggers-sdk-").dir;
    const home = join(sandbox, "home");
    const configDir = join(home, ".config", "loggers");
    const oldHome = process.env.HOME;
    const oldFetch = globalThis.fetch;
    let fetchCalls = 0;
    let lastUrl = "";

    try {
      mkdirSync(configDir, { recursive: true });
      process.env.HOME = home;
      writeFileSync(
        join(configDir, "loggers.yaml"),
        `loggers:\n  orders_api:\n    ulid: ${ULID}\n`,
        "utf-8",
      );
      globalThis.fetch = (async (url: string | URL) => {
        fetchCalls += 1;
        lastUrl = String(url);
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const logger = Loggers.create({
        name: "orders_api",
        component: "worker",
      });
      logger.info({ msg: "go remote" });
      await logger.flush();
      await logger.close();

      expect(fetchCalls).toBeGreaterThanOrEqual(1);
      expect(lastUrl).toContain(`/logger/${ULID}/batch`);
    } finally {
      globalThis.fetch = oldFetch;
      process.env.HOME = oldHome;
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("falls back to loggers.yaml when env name mapping is incomplete", async () => {
    const sandbox = makeTempDir("loggers-sdk-").dir;
    const home = join(sandbox, "home");
    const configDir = join(home, ".config", "loggers");
    const oldHome = process.env.HOME;
    const oldName = process.env.LOGGERS_NAME;
    const oldUlid = process.env.LOGGERS_ULID;
    const oldFetch = globalThis.fetch;
    let fetchCalls = 0;
    let lastUrl = "";

    try {
      mkdirSync(configDir, { recursive: true });
      process.env.HOME = home;
      process.env.LOGGERS_NAME = "orders_api";
      process.env.LOGGERS_ULID = "";
      writeFileSync(
        join(configDir, "loggers.yaml"),
        `loggers:\n  orders_api:\n    ulid: ${ULID}\n`,
        "utf-8",
      );
      globalThis.fetch = (async (url: string | URL) => {
        fetchCalls += 1;
        lastUrl = String(url);
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const logger = Loggers.create({
        name: "orders_api",
        component: "worker",
      });
      logger.info({ msg: "config fallback remote write" });
      await logger.close();

      expect(fetchCalls).toBeGreaterThanOrEqual(1);
      expect(lastUrl).toContain(`/logger/${ULID}/batch`);
    } finally {
      process.env.HOME = oldHome;
      process.env.LOGGERS_NAME = oldName;
      process.env.LOGGERS_ULID = oldUlid;
      globalThis.fetch = oldFetch;
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("writes local WARN diagnostic when name does not resolve to ULID", async () => {
    const sandbox = makeTempDir("loggers-sdk-").dir;
    const home = join(sandbox, "home");
    const oldHome = process.env.HOME;
    const oldName = process.env.LOGGERS_NAME;
    const oldUlid = process.env.LOGGERS_ULID;
    const oldFetch = globalThis.fetch;
    let fetchCalls = 0;
    try {
      mkdirSync(home, { recursive: true });
      process.env.HOME = home;
      process.env.LOGGERS_NAME = "orders_api";
      process.env.LOGGERS_ULID = "";
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const localDir = join(sandbox, "local-logs");
      const logger = Loggers.create({
        name: "orders_api",
        component: "worker",
        local: { dir: localDir, retentionDays: 7, timezone: "UTC" },
      });
      await logger.close();

      expect(fetchCalls).toBe(0);
      const files = readdirSync(join(localDir, "orders_api")).filter((f) =>
        f.endsWith(".log"),
      );
      expect(files.length).toBeGreaterThanOrEqual(1);
      const body = readFileSync(
        join(localDir, "orders_api", files[0]!),
        "utf-8",
      );
      expect(body).toContain('"level":"warn"');
      expect(body).toContain("name did not resolve to a valid ULID");
    } finally {
      process.env.HOME = oldHome;
      process.env.LOGGERS_NAME = oldName;
      process.env.LOGGERS_ULID = oldUlid;
      globalThis.fetch = oldFetch;
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("falls back to config level when LOGGERS_LEVEL is empty", async () => {
    const sandbox = makeTempDir("loggers-sdk-").dir;
    const home = join(sandbox, "home");
    const configDir = join(home, ".config", "loggers");
    const oldHome = process.env.HOME;
    const oldName = process.env.LOGGERS_NAME;
    const oldUlid = process.env.LOGGERS_ULID;
    const oldLevel = process.env.LOGGERS_LEVEL;
    const oldFetch = globalThis.fetch;
    try {
      mkdirSync(configDir, { recursive: true });
      process.env.HOME = home;
      process.env.LOGGERS_NAME = "";
      process.env.LOGGERS_ULID = "";
      process.env.LOGGERS_LEVEL = "";
      writeFileSync(
        join(configDir, "loggers.yaml"),
        `loggers:\n  orders_api:\n    ulid: ${ULID}\n    level: warn\n`,
        "utf-8",
      );
      globalThis.fetch = (async () =>
        new Response("{}", { status: 200 })) as typeof fetch;

      const localDir = join(sandbox, "local-logs");
      const logger = Loggers.create({
        name: "orders_api",
        component: "worker",
        local: { dir: localDir, retentionDays: 7, timezone: "UTC" },
      });
      const now = Date.now();
      logger.info({ msg: "info should drop by config level", now });
      logger.warn({ msg: "warn should keep by config level", now });
      await logger.close();

      const path = join(localDir, "orders_api", `${dayKeyUtc(now)}.log`);
      const body = readFileSync(path, "utf-8");
      expect(body).not.toContain("info should drop by config level");
      expect(body).toContain("warn should keep by config level");
    } finally {
      process.env.HOME = oldHome;
      process.env.LOGGERS_NAME = oldName;
      process.env.LOGGERS_ULID = oldUlid;
      process.env.LOGGERS_LEVEL = oldLevel;
      globalThis.fetch = oldFetch;
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
