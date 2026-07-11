import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

/**
 * Returns a key to identify the request source for rate-limiting and OTP isolation.
 *
 * INTENTIONAL DESIGN: By default this ignores X-Real-IP / X-Forwarded-For because
 * a directly exposed Next.js process receives those headers from the client and
 * they are trivial to spoof. In that mode every direct request shares the same
 * bucket (the string 'direct').
 *
 * This is conservative and intentional for a SINGLE-ADMIN emergency panel behind
 * an SSH tunnel / VPN — if a single admin fails their password/OTP a few times,
 * the shared bucket blocks further attempts from that admin too. This prevents
 * brute-force even if proxy headers are spoofed.
 *
 * Set ADMIN_TRUST_PROXY_HEADERS=true ONLY when the panel is reachable solely
 * through a trusted proxy/tunnel that overwrites X-Real-IP and X-Forwarded-For
 * before the request reaches Next.js, AND you have multiple admins who need
 * separate rate-limit buckets.
 */
export function clientKey(req: NextRequest): string {
  if (process.env.ADMIN_TRUST_PROXY_HEADERS !== 'true') return 'direct';

  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return 'direct';
}

export async function hashSecret(value: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(value, salt);
}

export async function verifySecret(value: string, hash: string): Promise<boolean> {
  return bcrypt.compare(value, hash);
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

export function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

export async function sendTelegram(text: string) {
  if (isDevMode()) {
    console.log(`[DEV MODE - AUDIT LOG SUPPRESSED] ${text}`);
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

// ── Startup warnings (logged once on module load) ──────────────────────────────
if (process.env.NODE_ENV === 'production' && process.env.ADMIN_TRUST_PROXY_HEADERS !== 'true') {
  console.warn(
    '[security] ADMIN_TRUST_PROXY_HEADERS is not set to "true" in production. ' +
    'All clients share a single rate-limit bucket ("direct"). If you have multiple admins, ' +
    'consider enabling it once the panel is only reachable through a trusted proxy.'
  );
}
if (isDevMode()) {
  console.warn(
    '[security] ADMIN_DEV_MODE is "true". Telegram audit logging is SUPPRESSED — ' +
    'actions are only logged to console with [DEV MODE - AUDIT LOG SUPPRESSED] prefix. ' +
    'Never use this setting in production.'
  );
}
