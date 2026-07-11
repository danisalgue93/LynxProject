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

// Verifica un codigo de 6 digitos contra el secreto TOTP del admin, con una
// tolerancia de +-1 paso (30s) para relojes ligeramente desincronizados.
export function verifyTotp(base32Secret: string, token: string, windowSteps = 1): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  if (!base32Secret) return false;
  const secret = base32Decode(base32Secret);
  if (secret.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const candidate = Buffer.from(hotp(secret, counter + delta), 'utf8');
    const expected = Buffer.from(token, 'utf8');
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
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
