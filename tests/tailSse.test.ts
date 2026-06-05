import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import {
  bootTestService,
  parseSseFrames,
  readSseStream,
  type TestService,
} from "pues/base/test/server";

describe("logger tail SSE — unit", () => {
  test("publishIngestedRows emits logs_batch to subscribers", async () => {
    process.env.SSE_BATCH_MAX_MS = "20";
    const {
      resetLoggerTailSseForTesting,
      subscribeLoggerEvents,
      publishIngestedRows,
    } = await import("../src/lib/loggerTailSse.js");
    resetLoggerTailSseForTesting();

    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const ctrl = new AbortController();
    const res = subscribeLoggerEvents(
      new Request("http://x/events", { signal: ctrl.signal }),
      ulid,
    );
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 5));
    publishIngestedRows(ulid, [
      {
        id: 1,
        logged_at: 1000,
        level: "info",
        component: "api",
        data: { n: 1 },
        meta: {},
        created_at: 1,
      },
      {
        id: 2,
        logged_at: 2000,
        level: "error",
        component: "api",
        data: { n: 2 },
        meta: {},
        created_at: 1,
      },
    ]);

    const body = await readSseStream(res.body!, 80);
    const events = parseSseFrames(body);
    const batch = events.find((e) => e.event === "logs_batch");
    expect(batch).toBeDefined();
    const payload = JSON.parse(batch!.data!) as {
      count: number;
      items: { id: number; logged_at: number }[];
    };
    expect(payload.count).toBe(2);
    expect(payload.items[0]?.logged_at).toBe(1000);
    expect(payload.items[1]?.logged_at).toBe(2000);

    ctrl.abort();
    resetLoggerTailSseForTesting();
  });

  test("Last-Event-ID replays buffered batches; stale id yields resync", async () => {
    process.env.SSE_BATCH_MAX_MS = "5";
    process.env.SSE_REPLAY_BUFFER_BATCHES = "50";
    const {
      resetLoggerTailSseForTesting,
      subscribeLoggerEvents,
      publishIngestedRows,
    } = await import("../src/lib/loggerTailSse.js");
    resetLoggerTailSseForTesting();

    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FBV";
    const ctrl1 = new AbortController();
    const res1 = subscribeLoggerEvents(
      new Request("http://x/events", { signal: ctrl1.signal }),
      ulid,
    );
    await new Promise((r) => setTimeout(r, 5));

    publishIngestedRows(ulid, [
      {
        id: 10,
        logged_at: 5000,
        level: "warn",
        component: "w",
        data: {},
        meta: {},
        created_at: 1,
      },
    ]);
    await new Promise((r) => setTimeout(r, 30));
    const firstBody = await readSseStream(res1.body!, 40);
    const firstEvents = parseSseFrames(firstBody);
    const batchEv = firstEvents.find((e) => e.event === "logs_batch");
    expect(batchEv?.id).toBeDefined();
    ctrl1.abort();

    const res2 = subscribeLoggerEvents(
      new Request("http://x/events", {
        headers: { "Last-Event-ID": batchEv!.id! },
      }),
      ulid,
    );
    const replayBody = await readSseStream(res2.body!, 40);
    const replayEvents = parseSseFrames(replayBody);
    expect(replayEvents.some((e) => e.event === "logs_batch")).toBe(false);

    const res3 = subscribeLoggerEvents(
      new Request("http://x/events", {
        headers: { "Last-Event-ID": "999999" },
      }),
      ulid,
    );
    const staleBody = await readSseStream(res3.body!, 40);
    expect(parseSseFrames(staleBody).some((e) => e.event === "resync")).toBe(
      true,
    );

    resetLoggerTailSseForTesting();
  });
});

describe("logger tail SSE — HTTP", () => {
  const TEST_CONTROL_DB = "data/test-tail-sse-control.db";
  const TEST_LOGGER_DIR = "data/test-tail-sse-per-ulid";
  const PORT = 3044;

  let svc: TestService;
  let base: string;
  let loggerUlid: string;

  beforeAll(async () => {
    if (existsSync(TEST_LOGGER_DIR))
      rmSync(TEST_LOGGER_DIR, { recursive: true });
    svc = await bootTestService(() => import("../src/api/server"), {
      port: PORT,
      dbPath: TEST_CONTROL_DB,
      env: { LOGGERS_DB_DIR: TEST_LOGGER_DIR, SSE_BATCH_MAX_MS: "30" },
    });
    base = svc.base;

    const create = await svc.post("/api/loggers", { label: "Tail SSE" });
    loggerUlid = (create.json as { id: string }).id;
  });

  afterAll(async () => {
    const { resetLoggerDbCacheForTesting, closeAllLoggerDbs } = await import(
      "../src/lib/loggerDb.js"
    );
    const { resetLoggerTailSseForTesting } = await import(
      "../src/lib/loggerTailSse.js"
    );
    resetLoggerTailSseForTesting();
    closeAllLoggerDbs();
    resetLoggerDbCacheForTesting();
    await svc.stop();
    if (existsSync(TEST_LOGGER_DIR))
      rmSync(TEST_LOGGER_DIR, { recursive: true });
  });

  test("GET /logger/:ulid/events streams logs_batch after ingest", async () => {
    const ctrl = new AbortController();
    const streamRes = await fetch(`${base}/logger/${loggerUlid}/events`, {
      signal: ctrl.signal,
      headers: { Accept: "text/event-stream" },
    });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("Content-Type")).toContain(
      "text/event-stream",
    );

    await new Promise((r) => setTimeout(r, 10));
    await fetch(`${base}/logger/${loggerUlid}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: "info",
        component: "tail-test",
        data: { ok: true },
        logged_at: Date.now(),
      }),
    });

    const body = await readSseStream(streamRes.body!, 120);
    const batch = parseSseFrames(body).find((e) => e.event === "logs_batch");
    expect(batch).toBeDefined();
    const payload = JSON.parse(batch!.data!) as {
      items: { component: string }[];
    };
    expect(payload.items[0]?.component).toBe("tail-test");
    ctrl.abort();
  });

  test("unknown ulid returns 404", async () => {
    const res = await fetch(
      `${base}/logger/01ARZ3NDEKTSV4RRFFQ69G5ZZZ/events`,
      { headers: { Accept: "text/event-stream" } },
    );
    expect(res.status).toBe(404);
  });
});
