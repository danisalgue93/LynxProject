import crypto from 'crypto';
import { NextRequest } from 'next/server';

/**
 * Returns a key to identify the request source for rate-limiting and OTP isolation.
 *
 * By default this ignores X-Real-IP / X-Forwarded-For because a directly
 * exposed Next.js process receives those headers from the client and they are
 * trivial to spoof. In that mode every direct request shares the same bucket,
 * which is conservative for a single-user emergency admin panel.
 *
 * Set ADMIN_TRUST_PROXY_HEADERS=true only when the panel is reachable solely
 * through a trusted proxy/tunnel that overwrites X-Real-IP and X-Forwarded-For
 * before the request reaches Next.js.
 */
export function clientKey(req: NextRequest): string {
  if (process.env.ADMIN_TRUST_PROXY_HEADERS !== 'true') return 'direct';

  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return 'direct';
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

// De-dupes rate-limit alerts so a sustained attack (many blocked requests)
// triggers a single Telegram notification per window instead of one per
// blocked request. In-memory only — consistent with the single-instance
// requirement already documented in lib/rate-limit.ts / lib/otp-store.ts.
const rateLimitAlertSentAt = new Map<string, number>();

/**
 * Notifies the team via Telegram the first time a given rate limit is hit
 * within `windowMs`. Because clientKey() collapses every direct client into
 * one 'direct' bucket unless ADMIN_TRUST_PROXY_HEADERS=true, a single
 * legitimate admin failing their password/OTP a few times can lock out
 * everyone else until the window expires — this alert lets operators notice
 * that and decide whether to enable trusted-proxy IP separation.
 */
export function notifyRateLimitHit(context: string, key: string, windowMs: number) {
  const dedupeKey = `${context}:${key}`;
  const now = Date.now();
  const lastSentAt = rateLimitAlertSentAt.get(dedupeKey);
  if (lastSentAt && now - lastSentAt < windowMs) return;
  rateLimitAlertSentAt.set(dedupeKey, now);

  sendTelegram(
    `*Lynx admin panel rate limit hit*\n\nContext: \`${context}\`\nKey: \`${key}\`\n\n` +
      `Requests are being blocked on this bucket. If ADMIN_TRUST_PROXY_HEADERS is not ` +
      `'true', all direct clients share one bucket — consider enabling it once you've ` +
      `confirmed the panel is only reachable through a trusted proxy.`
  ).catch((err) =>
    console.error('[security] rate-limit alert failed to send:', err instanceof Error ? err.message : err)
  );
}
