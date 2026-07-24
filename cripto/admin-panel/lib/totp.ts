/**
 * totp.ts
 *
 * Segundo factor de respaldo (RFC 6238 TOTP, tipo Google Authenticator /
 * Authy) para el login del panel admin, independiente de Telegram. Antes, el
 * OTP solo se entregaba por Telegram (hallazgo M5 de la auditoria): si el
 * bot o el chat de Telegram no estaban disponibles, no habia forma de
 * entrar salvo el `devOtp` de modo desarrollo. Ahora, si este admin tiene
 * configurado `ADMIN_TOTP_SECRET` en su propio .env, puede usar un codigo de
 * su app de autenticacion como alternativa siempre disponible.
 *
 * Sin dependencias externas: solo usa el modulo `crypto` de Node (HMAC-SHA1),
 * tal como especifica RFC 4226 (HOTP) / RFC 6238 (TOTP).
 */

import crypto, { timingSafeEqual } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

function base32Decode(input: string): Buffer {
  let bits = '';
  const cleaned = input.toUpperCase().replace(/=+$/, '');
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) throw new Error(`Invalid base32 character: ${char} at position ${i}`);
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

/**
 * Highest TOTP counter already spent, per secret.
 *
 * RFC 6238 §5.2 requires that a code be accepted only once: without this, a code
 * observed by any means (shoulder-surfed, read off a screen share, replayed from
 * a proxy log) stays valid for the rest of its ~90s acceptance window. Tracking
 * the last consumed counter turns TOTP into genuine one-time use.
 *
 * In-memory, consistent with the single-instance requirement documented in
 * rate-limit.ts. A restart forgets consumed counters — the worst
 * case is that one code stays replayable for the remainder of its 30s step,
 * which is strictly better than the unbounded reuse this replaces.
 */
const consumedCounters = new Map<string, number>();

/**
 * Verifies a 6-digit TOTP code, tolerating ±windowSteps (30s each) of clock skew.
 *
 * @param consume when true (the default for a real login) the matching counter is
 *   burned, so the same code cannot be presented twice. Pass false only to test a
 *   code without spending it.
 */
export function verifyTotp(
  base32Secret: string,
  token: string,
  windowSteps = 1,
  consume = true
): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  if (!base32Secret) return false;
  // A misconfigured ADMIN_TOTP_SECRET (spaces, hyphens, or otp-auth padding
  // pasted from a QR export) contains non-base32 characters, so base32Decode
  // throws. Without this guard that exception propagates out of the verify-otp
  // route as a 500 on EVERY login attempt — locking the operator out of the
  // emergency panel with a symptom indistinguishable from a server crash. Fail
  // closed to a clean "invalid code", and log the real cause so it's diagnosable
  // (mirrors how getAdminPasswordHash refuses a malformed ADMIN_PASSWORD).
  let secret: Buffer;
  try {
    secret = base32Decode(base32Secret);
  } catch (err) {
    console.error(
      '[totp] ADMIN_TOTP_SECRET is not valid base32 — TOTP verification cannot run. ' +
      'It must contain only A-Z and 2-7 (no spaces, hyphens or padding). ' +
      (err instanceof Error ? err.message : String(err))
    );
    return false;
  }
  if (secret.length === 0) return false;

  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const lastConsumed = consumedCounters.get(base32Secret);

  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const candidateCounter = counter + delta;
    // Reject anything at or below a counter already used for a successful login.
    if (consume && lastConsumed !== undefined && candidateCounter <= lastConsumed) continue;

    const candidate = Buffer.from(hotp(secret, candidateCounter), 'utf8');
    const expected = Buffer.from(token, 'utf8');
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      if (consume) consumedCounters.set(base32Secret, candidateCounter);
      return true;
    }
  }
  return false;
}

// Utilidad para generar un secreto nuevo al configurar un admin por primera
// vez (ejecutar una vez, guardar el resultado en ADMIN_TOTP_SECRET del .env
// de ESE admin, y cargarlo en su app de autenticacion como secreto base32).
export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let secret = '';
  for (const b of bytes) secret += BASE32_ALPHABET[b % 32];
  return secret;
}

export function isTotpConfigured(): boolean {
  return !!process.env.ADMIN_TOTP_SECRET;
}
