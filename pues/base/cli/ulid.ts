/**
 * ULID helpers for CLIs, re-exported from `base/core/ulid` so a CLI
 * vendoring `cli` gets the canonical fleet ULID semantics without also
 * importing `core` directly — and stays byte-for-byte identical to the
 * service that mints the IDs.
 *
 * `normalizeUlid` is the CLI-only addition: trim + upper-case, validate
 * against `ULID_RE`, and exit(2) with a contextual message on a bad id
 * (the shape every CLI wants when reading a ULID from a flag/file/prompt).
 */

import { ULID_RE } from "../core/ulid";

export {
  bytesToUlid,
  isUlid,
  ULID_RE,
  ulid,
  ulidPattern,
  ulidTime,
  ulidToBytes,
} from "../core/ulid";

/** Trim/upper-case, validate, and return — or print `ctx` + exit(2). */
export function normalizeUlid(raw: string, ctx: string): string {
  const id = raw.trim().toUpperCase();
  if (!ULID_RE.test(id)) {
    console.error(`${ctx}: invalid ULID (expected 26-char Crockford base32)`);
    process.exit(2);
  }
  return id;
}
