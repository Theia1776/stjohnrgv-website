/**
 * Password-reset code generation + hashing.
 *
 * The "forgot password" flow emails the member a short numeric code.
 * We store only an HMAC of that code (never the plaintext) in
 * public.password_resets, so a leaked table dump can't be turned back
 * into a working code without the HMAC key.
 *
 * The HMAC key is the Supabase service-role key — already a server-only
 * secret available to the functions that need it, so this adds no new
 * env var to manage. The code itself is only 6 digits, but the
 * verify endpoint caps attempts (5) and codes expire (15 min), so an
 * online guess of a 6-digit space is impractical; the HMAC is
 * defense-in-depth for the at-rest case.
 */

/** Number of digits in a reset code. */
export const CODE_LENGTH = 6;

/** How long a freshly issued code stays valid. */
export const CODE_TTL_MS = 15 * 60 * 1000;

/** Max number of verify attempts against a single code before it dies. */
export const MAX_ATTEMPTS = 5;

/** Max codes a single email may request inside one TTL window. */
export const MAX_CODES_PER_WINDOW = 3;

/**
 * Generate a cryptographically-random zero-padded numeric code, e.g.
 * "042918". Uses rejection sampling so every value in [0, 10^len) is
 * equally likely (no modulo bias).
 */
export function generateCode(length: number = CODE_LENGTH): string {
  const max = 10 ** length; // exclusive upper bound
  // Largest multiple of `max` that fits in a Uint32, for rejection.
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return String(n % max).padStart(length, "0");
}

/**
 * HMAC-SHA256 the code with the given key, returned as lowercase hex.
 * Deterministic, so the same (code, key) always yields the same hash —
 * which is how the verify endpoint compares a submitted code against
 * the stored hash.
 */
export async function hashCode(code: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(code));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time comparison of two equal-length hex strings. Avoids
 * leaking how many leading characters matched via timing. (Both inputs
 * here are fixed-length hex HMACs, so length equality is expected.)
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
