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

/**
 * Build the server-owned `meta` for a log line. Holds only fields the
 * server owns — `component`, `ingested_at`, and a `redactions` audit of
 * sensitive key paths found in `data`. Client fields are NOT promoted:
 * `data` is stored verbatim and stays the source of truth for things like
 * `path` / `status` / `msg`. (We also deliberately do not store client IP.)
 */
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

  return meta;
}
