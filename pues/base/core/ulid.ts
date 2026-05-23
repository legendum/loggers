/**
 * ULID-compatible sortable public ids, and a matcher for them.
 *
 * Layout: 10 chars of 48-bit ms timestamp (Crockford base32, big-endian)
 * followed by `randomChars` of randomness (default 16 → 80 bits).
 *
 * "ULID-compatible", not spec-strict: the random tail uses one base32 char
 * per random byte (bias-free, since 256 = 32 × 8) rather than packing across
 * byte boundaries. The result is still lexically sortable by creation time,
 * URL-safe, Crockford base32, and unique with overwhelming probability — all
 * any consumer here relies on. The first char is always 0-7 (the high 2 bits
 * of a 48-bit ms timestamp are zero until ~year 10889), which `ULID_RE`
 * enforces.
 *
 * Consumers that want shorter ids for usability pass a smaller `randomChars`
 * (e.g. todos mints 20-char ids via `ulid(10)`).
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const DEFAULT_RANDOM_LEN = 16;

/** Mint a new ULID-compatible id. `randomChars` defaults to 16 (26-char id). */
export function ulid(randomChars = DEFAULT_RANDOM_LEN): string {
  return encodeTime(Date.now()) + encodeRandom(randomChars);
}

function encodeTime(ms: number): string {
  let t = ms;
  let out = "";
  for (let i = 0; i < TIME_LEN; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(n: number): string {
  // 256 = 32 * 8 exactly, so `byte % 32` is bias-free.
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < n; i++) out += CROCKFORD[bytes[i]! % 32];
  return out;
}

/** Matches a standard 26-char id. First char is 0-7 (timestamp high bits). */
export const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

/** Build a matcher for a non-standard total `length` (todos mints 20). */
export function ulidPattern(length = 26): RegExp {
  return new RegExp(`^[0-7][0-9A-HJKMNP-TV-Z]{${length - 1}}$`, "i");
}

/** True if `value` is a standard 26-char ULID-compatible id. */
export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}
