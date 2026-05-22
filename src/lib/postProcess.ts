const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "api_key",
  "apikey",
  "secret",
  "cookie",
  "authorization",
  "auth",
]);

const META_EXTRACT_KEYS = [
  "request_id",
  "trace_id",
  "span_id",
  "route",
  "path",
  "user_id",
  "actor_id",
  "module",
  "msg",
  "message",
  "status",
  "kind",
  "ok",
] as const;

function collectSensitiveKeys(
  value: unknown,
  path: string,
  out: string[],
): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectSensitiveKeys(value[i], `${path}[${i}]`, out);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SENSITIVE_KEYS.has(key.toLowerCase())) out.push(childPath);
    collectSensitiveKeys(child, childPath, out);
  }
}

/** Derive server-owned meta from client data (data is stored unchanged). */
export function buildMeta(
  data: Record<string, unknown>,
  component: string,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    component,
    ingested_at: Math.floor(Date.now() / 1000),
  };

  const redactions: string[] = [];
  collectSensitiveKeys(data, "", redactions);
  if (redactions.length > 0) meta.redactions = redactions;

  for (const key of META_EXTRACT_KEYS) {
    if (!(key in data)) continue;
    const v = data[key];
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      meta[key] = v;
    }
  }

  return meta;
}
