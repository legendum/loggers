/**
 * Server-Sent Events with per-user fan-out (SPEC §7).
 *
 * Two things come out of `sseRoute()`:
 *   1. A route map the consumer spreads into Bun.serve — typically
 *      `{ "/api/events": { GET } }`.
 *   2. A `broadcast(userId, event, data, { op_id })` function that mutation
 *      handlers call after a successful write. Broadcasts are scoped by
 *      `userId`; there is intentionally no global-broadcast helper, so it is
 *      impossible to ship one user's mutations to another user's stream.
 *
 * Anonymous visitors (resolveUser → null) get a 401: SSE always implies an
 * authenticated stream. Public-read consumers (linkobot) still serve their
 * `auth: { get: "public" }` data via REST; they just don't receive live
 * updates over SSE.
 *
 * Last-Event-ID replay
 * --------------------
 * Every broadcast frame carries a monotonic `id:` and lands in a per-user
 * ring buffer (`RING_MAX` entries). On reconnect, native `EventSource`
 * auto-sends `Last-Event-ID`; if the id is in the ring we replay strictly
 * newer entries before going live, otherwise we emit a single synthetic
 * `resync` event so the client can rebuild its cache (via REST). The
 * counter is per-process and not persisted — a server restart guarantees
 * the next client id is < the new counter's tail, which triggers `resync`
 * naturally.
 */

import type { ResolveUserFn } from "../objects/mountResource";

export type Broadcast = (
  userId: number,
  event: string,
  data: unknown,
  opts?: { op_id?: string | null },
) => void;

export type SseRouteArgs = {
  resolveUser: ResolveUserFn;
  path?: string;
  heartbeatMs?: number;
  /** Per-user ring-buffer size. Defaults to 200 events. Set to 0 to
   * disable replay entirely (clients always get `resync` on reconnect
   * with a Last-Event-ID header). */
  ringMax?: number;
};

export type SseRouteResult = {
  routes: Record<
    string,
    Record<string, (req: Request) => Response | Promise<Response>>
  >;
  broadcast: Broadcast;
  streamCount: () => number;
};

const DEFAULT_PATH = "/api/events";
const DEFAULT_HEARTBEAT_MS = 20_000;
const DEFAULT_RING_MAX = 200;

type StreamCtrl = {
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
};

type RingEntry = {
  id: number;
  /** Pre-encoded SSE frame (`event:`/`id:`/`data:` lines) — replayed verbatim. */
  frame: Uint8Array;
};

export function sseRoute(args: SseRouteArgs): SseRouteResult {
  const path = args.path ?? DEFAULT_PATH;
  const heartbeatMs = args.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const ringMax = args.ringMax ?? DEFAULT_RING_MAX;
  const streams = new Map<number, Set<StreamCtrl>>();
  const rings = new Map<number, RingEntry[]>();
  const encoder = new TextEncoder();
  let counter = 0;
  const nextId = (): number => ++counter;

  const handler = async (req: Request): Promise<Response> => {
    const uid = await args.resolveUser(req);
    if (uid == null) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return makeStreamResponse(
      req,
      uid,
      streams,
      rings,
      heartbeatMs,
      encoder,
      nextId,
    );
  };

  const broadcast: Broadcast = (userId, event, data, opts) => {
    const payload =
      typeof data === "object" && data !== null
        ? { ...(data as object), op_id: opts?.op_id ?? null }
        : { value: data, op_id: opts?.op_id ?? null };
    const id = nextId();
    const chunk = encoder.encode(
      `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(payload)}\n\n`,
    );

    if (ringMax > 0) {
      let ring = rings.get(userId);
      if (!ring) {
        ring = [];
        rings.set(userId, ring);
      }
      ring.push({ id, frame: chunk });
      if (ring.length > ringMax) ring.shift();
    }

    const set = streams.get(userId);
    if (!set || set.size === 0) return;
    for (const ctrl of set) {
      try {
        ctrl.enqueue(chunk);
      } catch {
        // controller closed under our feet — drop it silently
      }
    }
  };

  const streamCount = () => {
    let n = 0;
    for (const s of streams.values()) n += s.size;
    return n;
  };

  return {
    routes: { [path]: { GET: handler } },
    broadcast,
    streamCount,
  };
}

function makeStreamResponse(
  req: Request,
  uid: number,
  streams: Map<number, Set<StreamCtrl>>,
  rings: Map<number, RingEntry[]>,
  heartbeatMs: number,
  encoder: TextEncoder,
  nextId: () => number,
): Response {
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

      let set = streams.get(uid);
      if (!set) {
        set = new Set();
        streams.set(uid, set);
      }
      set.add(ctrl);

      // Initial comment so EventSource sees a successful connect.
      controller.enqueue(encoder.encode(`: connected\n\n`));

      // Last-Event-ID replay. Browsers send it as a header on reconnect;
      // when present and valid we either replay strictly newer entries
      // from the ring or emit a single `resync` event if the id is
      // outside the ring (stale or pre-restart).
      const lastIdHeader = req.headers.get("Last-Event-ID");
      const parsed = lastIdHeader
        ? Number.parseInt(lastIdHeader, 10)
        : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        const ring = rings.get(uid) ?? [];
        const head = ring.length ? ring[ring.length - 1]!.id : 0;
        const tail = ring.length ? ring[0]!.id : 0;
        if (parsed > head || (ring.length > 0 && parsed < tail - 1)) {
          const resyncId = nextId();
          controller.enqueue(
            encoder.encode(`event: resync\nid: ${resyncId}\ndata: {}\n\n`),
          );
        } else {
          for (const e of ring) {
            if (e.id > parsed) controller.enqueue(e.frame);
          }
        }
      }

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, heartbeatMs);

      const teardown = () => {
        clearInterval(heartbeat);
        set!.delete(ctrl);
        if (set!.size === 0) streams.delete(uid);
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
    },
  });
}
