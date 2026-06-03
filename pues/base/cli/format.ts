/**
 * Output formatting for CLIs offering `--json` / `--yaml` / text.
 *
 * `pickFormat` reads the parsed flags (`--json` wins, then `--yaml`,
 * else text). `formatPayload` renders accordingly: JSON and YAML are
 * universal, while the text branch is inherently app-specific, so the
 * caller passes a `textFn` that knows how to pretty-print *its* payload
 * shape (a log line, a queue row, …). Without a `textFn` the text branch
 * falls back to `String(payload)`. `printPayload` is the console.log
 * convenience over `formatPayload`.
 */

import type { FlagValue } from "./args";

export type Format = "text" | "json" | "yaml";

export function pickFormat(flags: Map<string, FlagValue>): Format {
  if (flags.has("json")) return "json";
  if (flags.has("yaml")) return "yaml";
  return "text";
}

export function formatPayload(
  payload: unknown,
  format: Format,
  textFn?: (payload: unknown) => string,
): string {
  if (format === "json") return JSON.stringify(payload, null, 2);
  if (format === "yaml") return Bun.YAML.stringify(payload, null, 2);
  return textFn ? textFn(payload) : String(payload);
}

export function printPayload(
  payload: unknown,
  format: Format,
  textFn?: (payload: unknown) => string,
): void {
  console.log(formatPayload(payload, format, textFn));
}
