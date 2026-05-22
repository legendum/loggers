import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";

function lineParse(
  text: string,
): Array<{ event?: string; id?: string; data?: string }> {
  const out: Array<{ event?: string; id?: string; data?: string }> = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    if (block.startsWith(":")) continue;
    const ev: { event?: string; id?: string; data?: string } = {};
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) ev.event = line.slice(7);
      else if (line.startsWith("id: ")) ev.id = line.slice(4);
      else if (line.startsWith("data: ")) ev.data = line.slice(6);
    }
    if (ev.event || ev.data) out.push(ev);
  }
  return out;
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  ms: number,
): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const t = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: undefined }>((r) =>
        setTimeout(() => r({ done: true }), Math.max(0, deadline - Date.now())),
      ),
    ]);
    if (t.done) break;
    if (t.value) buf += dec.decode(t.value, { stream: true });
  }
  reader.releaseLock();
  return buf;
}

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

    const body = await readStream(res.body!, 80);
    const events = lineParse(body);
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
    const firstBody = await readStream(res1.body!, 40);
    const firstEvents = lineParse(firstBody);
    const batchEv = firstEvents.find((e) => e.event === "logs_batch");
    expect(batchEv?.id).toBeDefined();
    ctrl1.abort();

    const res2 = subscribeLoggerEvents(
      new Request("http://x/events", {
        headers: { "Last-Event-ID": batchEv!.id! },
      }),
      ulid,
    );
    const replayBody = await readStream(res2.body!, 40);
    const replayEvents = lineParse(replayBody);
    expect(replayEvents.some((e) => e.event === "logs_batch")).toBe(false);

    const res3 = subscribeLoggerEvents(
      new Request("http://x/events", {
        headers: { "Last-Event-ID": "999999" },
      }),
      ulid,
    );
    const staleBody = await readStream(res3.body!, 40);
    expect(lineParse(staleBody).some((e) => e.event === "resync")).toBe(true);

    resetLoggerTailSseForTesting();
  });
});

describe("logger tail SSE — HTTP", () => {
  process.env.PUES_DB_PATH = "data/test-tail-sse-control.db";
  process.env.LOGGERS_DB_DIR = "data/test-tail-sse-per-ulid";
  process.env.SSE_BATCH_MAX_MS = "30";
  const TEST_CONTROL_DB = process.env.PUES_DB_PATH as string;
  const TEST_LOGGER_DIR = process.env.LOGGERS_DB_DIR as string;
  const PORT = 3044;

  let server: { stop: () => void } | undefined;
  let base: string;
  let loggerUlid: string;

  beforeAll(async () => {
    delete process.env.LEGENDUM_API_KEY;
    delete process.env.LEGENDUM_SECRET;
    mkdirSync("data", { recursive: true });
    if (existsSync(TEST_CONTROL_DB)) rmSync(TEST_CONTROL_DB);
    if (existsSync(TEST_LOGGER_DIR))
      rmSync(TEST_LOGGER_DIR, { recursive: true });

    const mod = await import("../src/api/server");
    server = Bun.serve({ ...mod.default, port: PORT });
    base = `http://localhost:${PORT}`;

    const create = await fetch(`${base}/api/loggers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Tail SSE" }),
    });
    loggerUlid = ((await create.json()) as { id: string }).id;
  });

  afterAll(async () => {
    server?.stop();
    const { resetDbForTesting } = await import("pues/base/db/server");
    const { resetLoggerDbCacheForTesting, closeAllLoggerDbs } = await import(
      "../src/lib/loggerDb.js"
    );
    const { resetLoggerTailSseForTesting } = await import(
      "../src/lib/loggerTailSse.js"
    );
    resetLoggerTailSseForTesting();
    closeAllLoggerDbs();
    resetLoggerDbCacheForTesting();
    resetDbForTesting();
    if (existsSync(TEST_CONTROL_DB)) rmSync(TEST_CONTROL_DB);
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

    const body = await readStream(streamRes.body!, 120);
    const batch = lineParse(body).find((e) => e.event === "logs_batch");
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
