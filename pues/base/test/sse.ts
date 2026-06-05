/**
 * SSE test helpers — read a Server-Sent-Events stream under a deadline and parse
 * its frames. Testing `base/sse` (or any SSE route) otherwise means re-typing the
 * frame parser and the bounded stream reader in every consumer.
 *
 *   const res = await fetch(`${base}/sse`, { headers: { Accept: "text/event-stream" } });
 *   const frames = await collectSseFrames(res.body!, 200);
 *   expect(frames.some((f) => f.event === "logs_batch")).toBe(true);
 */

export type SseFrame = { event?: string; id?: string; data?: string };

/** Parse raw SSE text into frames. Blank-line-separated blocks; `:` comment
 *  blocks are skipped; multi-field blocks collapse to one frame. */
export function parseSseFrames(text: string): SseFrame[] {
  const out: SseFrame[] = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim() || block.startsWith(":")) continue;
    const ev: SseFrame = {};
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) ev.event = line.slice(7);
      else if (line.startsWith("id: ")) ev.id = line.slice(4);
      else if (line.startsWith("data: ")) ev.data = line.slice(6);
    }
    if (ev.event || ev.data) out.push(ev);
  }
  return out;
}

/** Read from an SSE byte stream until it closes or `ms` elapses, returning the
 *  accumulated text. Bounded so a never-closing stream can't hang the test. */
export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  ms: number,
): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const t = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value?: undefined }>((r) =>
          setTimeout(
            () => r({ done: true }),
            Math.max(0, deadline - Date.now()),
          ),
        ),
      ]);
      if (t.done) break;
      if (t.value) buf += dec.decode(t.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return buf;
}

/** `readSseStream` + `parseSseFrames` in one call. */
export async function collectSseFrames(
  stream: ReadableStream<Uint8Array>,
  ms: number,
): Promise<SseFrame[]> {
  return parseSseFrames(await readSseStream(stream, ms));
}
