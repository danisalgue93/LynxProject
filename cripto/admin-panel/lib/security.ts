import crypto from 'crypto';
import { NextRequest } from 'next/server';

/**
 * Returns a key to identify the request source for rate-limiting and OTP isolation.
 *
 * Priority:
 *  1. `x-real-ip` — set by a trusted reverse proxy (Nginx) to the actual client IP.
 *     More reliable than x-forwarded-for because it contains exactly one address.
 *  2. `x-forwarded-for` first segment — fallback; still controllable by the client
 *     if no upstream proxy overwrites it, so prefer x-real-ip wherever possible.
 *  3. `'local'` — development fallback when neither header is present.
 *
 * Production note: ensure Nginx (or your load balancer) sets `X-Real-IP` and
 * removes/overwrites any client-supplied `X-Forwarded-For` before the request
 * reaches Next.js, so this value cannot be spoofed.
 */
export function clientKey(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return 'local';
}

export function hashSecret(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function timingSafeEqualText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function assertEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function isDevMode() {
  return process.env.ADMIN_DEV_MODE === 'true';
}

export async function sendTelegram(text: string) {
  if (isDevMode()) {
    console.log(`[DEV TELEGRAM] ${text}`);
    return;
  }

  const token = assertEnv('TELEGRAM_BOT_TOKEN');
  const chatId = assertEnv('TELEGRAM_CHAT_ID');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    throw new Error('Telegram notification failed');
  }
}
