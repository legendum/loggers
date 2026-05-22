/**
 * ULID generator — 26-char Crockford base32, per the published spec.
 */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(): string {
  let t = Date.now();
  let ts = "";
  for (let i = 0; i < 10; i++) {
    ts = ENCODING[t % 32] + ts;
    t = Math.floor(t / 32);
  }

  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let rand = "";
  for (let i = 0; i < 16; i++) {
    rand = ENCODING[Number(n & 0x1fn)] + rand;
    n >>= 5n;
  }

  return ts + rand;
}
