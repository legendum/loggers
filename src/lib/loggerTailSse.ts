import {
  sseBatchMaxEvents,
  sseBatchMaxMs,
  sseHeartbeatMs,
  sseReplayBufferBatches,
} from "./constants.js";
import { type InsertedLogRow, toWireRow, type WireLogRow } from "./ingest.js";

export type TailLogItem = WireLogRow;

export type LogsBatchPayload = {
  items: TailLogItem[];
  count: number;
  from_logged_at: number;
  to_logged_at: number;
};

type StreamCtrl = {
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
};

type RingEntry = {
  id: number;
  frame: Uint8Array;
};

type UlidState = {
  pending: TailLogItem[];
  timer: ReturnType<typeof setTimeout> | null;
  streams: Set<StreamCtrl>;
  ring: RingEntry[];
  nextId: number;
};

const byUlid = new Map<string, UlidState>();
const encoder = new TextEncoder();

function normalizeUlid(ulid: string): string {
  return ulid.toUpperCase();
}

function getState(ulid: string): UlidState {
  const key = normalizeUlid(ulid);
  let state = byUlid.get(key);
  if (!state) {
    state = {
      pending: [],
      timer: null,
      streams: new Set(),
      ring: [],
      nextId: 0,
    };
    byUlid.set(key, state);
  }
  return state;
}

function buildBatchPayload(items: TailLogItem[]): LogsBatchPayload {
  const sorted = [...items].sort(
    (a, b) => a.logged_at - b.logged_at || a.id - b.id,
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    items: sorted,
    count: sorted.length,
    from_logged_at: first?.logged_at ?? 0,
    to_logged_at: last?.logged_at ?? 0,
  };
}

function encodeFrame(
  state: UlidState,
  event: string,
  data: unknown,
): { id: number; frame: Uint8Array } {
  const id = ++state.nextId;
  const frame = encoder.encode(
    `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`,
  );
  return { id, frame };
}

function pushRing(state: UlidState, entry: RingEntry): void {
  const max = sseReplayBufferBatches();
  if (max <= 0) return;
  state.ring.push(entry);
  if (state.ring.length > max) state.ring.shift();
}

function emitToStreams(state: UlidState, frame: Uint8Array): void {
  if (state.streams.size === 0) return;
  for (const ctrl of state.streams) {
    try {
      ctrl.enqueue(frame);
    } catch {
      // stream closed
    }
  }
}

function emitBatch(ulid: string, items: TailLogItem[]): void {
  if (items.length === 0) return;
  const state = getState(ulid);
  const payload = buildBatchPayload(items);
  const { frame } = encodeFrame(state, "logs_batch", payload);
  pushRing(state, { id: state.nextId, frame });
  emitToStreams(state, frame);
}

function flushPending(ulid: string): void {
  const state = getState(ulid);
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.pending.length === 0) return;
  emitBatch(ulid, state.pending.splice(0));
}

function scheduleFlush(ulid: string): void {
  const state = getState(ulid);
  if (state.timer) return;
  state.timer = setTimeout(() => flushPending(ulid), sseBatchMaxMs());
}

/** Queue ingested rows for batched `logs_batch` delivery on `/logger/:ulid/events`. */
export function publishIngestedRows(
  ulid: string,
  rows: InsertedLogRow[],
): void {
  if (rows.length === 0) return;
  const state = getState(ulid);
  for (const row of rows) {
    state.pending.push(toWireRow(row));
  }
  const max = sseBatchMaxEvents();
  while (state.pending.length >= max) {
    emitBatch(ulid, state.pending.splice(0, max));
  }
  if (state.pending.length > 0) scheduleFlush(ulid);
}

/** `GET /logger/:ulid/events` — public SSE tail (ULID is the credential). */
export function subscribeLoggerEvents(req: Request, ulid: string): Response {
  const state = getState(ulid);
  const heartbeatMs = sseHeartbeatMs();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const ctrl: StreamCtrl = {
        enqueue: (chunk) => controller.enqueue(chunk),
        close: () => {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
      };
      state.streams.add(ctrl);
      controller.enqueue(encoder.encode(": connected\n\n"));

      const lastIdHeader = req.headers.get("Last-Event-ID");
      const parsed = lastIdHeader
        ? Number.parseInt(lastIdHeader, 10)
        : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        const ring = state.ring;
        const head = ring.length ? ring[ring.length - 1]!.id : 0;
        const tail = ring.length ? ring[0]!.id : 0;
        if (parsed > head || (ring.length > 0 && parsed < tail - 1)) {
          const { frame } = encodeFrame(state, "resync", {});
          controller.enqueue(frame);
        } else {
          for (const entry of ring) {
            if (entry.id > parsed) controller.enqueue(entry.frame);
          }
        }
      }

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, heartbeatMs);

      const teardown = () => {
        clearInterval(heartbeat);
        state.streams.delete(ctrl);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener("abort", teardown, { once: true });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...loggerApiCorsHeaders(),
    },
  });
}

function loggerApiCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID",
  };
}

/** Test helper — drop all tail SSE state. */
export function resetLoggerTailSseForTesting(): void {
  for (const state of byUlid.values()) {
    if (state.timer) clearTimeout(state.timer);
    for (const ctrl of state.streams) ctrl.close();
  }
  byUlid.clear();
}
