/**
 * HTTP + JSON helpers for CLIs that talk to a Legendum service.
 *
 * `request` is a thin `fetch` wrapper that returns the status, the raw
 * body text, and the headers — and exits(2) on a network error rather
 * than throwing, since a CLI has nowhere useful to surface a rejection.
 * Callers pass a fully-built URL.
 *
 * `dieFromHttp` turns a failed `FetchResult` into a one-line `Error
 * (<status>): <message>` on stderr and exits(2), pulling `message` /
 * `error` out of a JSON body when present. `asObject` / `getString` are
 * the small structural guards used to read untyped JSON safely.
 */

export type FetchResult = {
  status: number;
  body: string;
  headers: Headers;
};

export async function request(
  url: string,
  method: string,
  init: { body?: string; headers?: Record<string, string> } = {},
): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      body: init.body,
      headers: init.headers,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Network error: ${msg}`);
    process.exit(2);
  }
  return { status: res.status, body: await res.text(), headers: res.headers };
}

/**
 * Parse a response body, or `null` on invalid JSON. Generic so a caller can
 * pin the expected shape (`parseJSON<{ id: string }>(body)`); it defaults to
 * `any` because a CLI reads untyped wire JSON and almost always reads fields
 * straight off the result — pinning `unknown` here only forced every consumer
 * to re-cast. Pass an explicit `T` (or run it through `asObject`) when you want
 * the type checker to hold you to a shape.
 */
export function parseJSON<T = any>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

export function asObject(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

export function getString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function dieFromHttp(res: FetchResult): never {
  const obj = asObject(parseJSON(res.body));
  const msg =
    getString(obj?.message) ||
    getString(obj?.error) ||
    res.body ||
    `HTTP ${res.status}`;
  console.error(`Error (${res.status}): ${msg}`);
  process.exit(2);
}
