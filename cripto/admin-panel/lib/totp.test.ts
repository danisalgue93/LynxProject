import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import { verifyTotp, generateTotpSecret } from './totp';

/**
 * TOTP is now the only second factor for the admin panel, so its correctness is
 * the whole of the panel's 2FA. These tests cover the RFC 6238 behaviour and,
 * above all, the one-time-use property: without consuming the counter, a code
 * seen by any means stays valid for the rest of its ~90s acceptance window.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

/** Independent TOTP generator, so the tests do not just re-run the implementation. */
function generateCode(base32Secret: string, atSeconds = Date.now() / 1000): string {
  let bits = '';
  for (const ch of base32Secret.toUpperCase().replace(/=+$/, '')) {
    bits += BASE32.indexOf(ch).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const secret = Buffer.from(bytes);

  const counter = Math.floor(atSeconds / STEP);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('verifyTotp', () => {
  it('accepts a correct current code', () => {
    // A fresh secret each test: consumed counters are tracked per secret, so
    // reusing one across tests would leak state between them.
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, generateCode(secret))).toBe(true);
  });

  it('rejects a wrong code', () => {
    const secret = generateTotpSecret();
    const wrong = generateCode(secret) === '000000' ? '111111' : '000000';
    expect(verifyTotp(secret, wrong)).toBe(false);
  });

  it('rejects malformed input rather than throwing', () => {
    const secret = generateTotpSecret();
    for (const bad of ['', 'abcdef', '12345', '1234567', '12 34 56']) {
      expect(verifyTotp(secret, bad)).toBe(false);
    }
  });

  it('rejects a code generated from a different secret', () => {
    const secret = generateTotpSecret();
    const other = generateTotpSecret();
    expect(verifyTotp(secret, generateCode(other))).toBe(false);
  });

  // The property this whole factor rests on: one code, one login.
  it('refuses to accept the same code twice (replay protection)', () => {
    const secret = generateTotpSecret();
    const code = generateCode(secret);

    expect(verifyTotp(secret, code)).toBe(true);
    // Same code, same 30s window: an attacker who observed it must not get in.
    expect(verifyTotp(secret, code)).toBe(false);
  });

  it('does not consume the counter when asked not to', () => {
    const secret = generateTotpSecret();
    const code = generateCode(secret);

    expect(verifyTotp(secret, code, 1, false)).toBe(true);
    expect(verifyTotp(secret, code, 1, false)).toBe(true);
    // …and the code is still usable for a real login afterwards.
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('accepts a code from the previous step (clock skew tolerance)', () => {
    const secret = generateTotpSecret();
    const previousStep = generateCode(secret, Date.now() / 1000 - STEP);
    expect(verifyTotp(secret, previousStep)).toBe(true);
  });

  it('rejects a code well outside the tolerance window', () => {
    const secret = generateTotpSecret();
    const old = generateCode(secret, Date.now() / 1000 - STEP * 10);
    expect(verifyTotp(secret, old)).toBe(false);
  });

  // Consuming a counter must not lock out the codes that come after it.
  it('still accepts the next step after one has been consumed', () => {
    vi.useFakeTimers();
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    vi.setSystemTime(base);

    const secret = generateTotpSecret();
    expect(verifyTotp(secret, generateCode(secret, base / 1000))).toBe(true);

    // 30s later the authenticator shows a new code; it must work.
    vi.setSystemTime(base + STEP * 1000);
    expect(verifyTotp(secret, generateCode(secret, (base + STEP * 1000) / 1000))).toBe(true);
  });

  it('rejects a stale code after a newer one has been consumed', () => {
    vi.useFakeTimers();
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    const secret = generateTotpSecret();

    const oldCode = generateCode(secret, base / 1000);
    vi.setSystemTime(base + STEP * 1000);
    // Consume the newer counter first.
    expect(verifyTotp(secret, generateCode(secret, (base + STEP * 1000) / 1000))).toBe(true);
    // The older code is still inside the ±1 step window, but its counter is now
    // below the consumed watermark — replaying it must fail.
    expect(verifyTotp(secret, oldCode)).toBe(false);
  });
});

describe('generateTotpSecret', () => {
  it('produces a 20-character base32 secret', () => {
    const s = generateTotpSecret();
    expect(s).toHaveLength(20);
    expect(s).toMatch(/^[A-Z2-7]{20}$/);
  });

  it('produces a different secret every time', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
  });
});
