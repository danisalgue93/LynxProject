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

/** A bcrypt digest: $2a$/$2b$/$2y$ + cost + 53 chars of salt+hash. */
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * Reads ADMIN_PASSWORD and fails loudly if it is not a bcrypt hash.
 *
 * bcrypt.compare(password, notAHash) resolves to `false` — it does not throw.
 * So an ADMIN_PASSWORD stored as plaintext (the intuitive thing to do, and
 * exactly what the old committed .env.local contained:
 * `ADMIN_PASSWORD=lynx-local-admin`) makes *every* login return 401, including
 * the correct password, with nothing in the logs to say why.
 *
 * That fails closed, so it is not a security hole — it is worse in a different
 * way: it locks the operator out of the emergency admin panel at the exact
 * moment they need it, and the symptom is indistinguishable from "wrong
 * password". Refuse to start instead of failing silently.
 */
export function getAdminPasswordHash(): string {
  const raw = process.env.ADMIN_PASSWORD;

  // Next.js expands `$VAR` references inside .env files. A bcrypt digest starts
  // with `$2a$12$...`, so `$2a` and `$12` are treated as (undefined) variable
  // references and the value silently collapses to an empty string — verified:
  // `ADMIN_PASSWORD=$2a$12$Adwj...` in .env.local is read back as "".
  //
  // The result was that the admin panel could not be logged into at all, by
  // either route: a bcrypt hash in .env.local was blanked here (500 on every
  // request-otp), and a plaintext password — the intuitive alternative, and what
  // the committed .env.local actually contained — made bcrypt.compare() return
  // false for every attempt (401). Both failures look like "wrong password".
  //
  // Escape each `$` as `\$` in the .env file, or supply ADMIN_PASSWORD through a
  // real environment variable / secret mount, which is not expanded.
  if (raw === '' || raw === undefined) {
    throw new Error(
      'ADMIN_PASSWORD is empty or unset.\n' +
      'If you put a bcrypt hash in a .env file, Next.js expanded the `$` sequences in it ' +
      '($2a, $12, ...) and blanked the value. Escape them:\n' +
      '  ADMIN_PASSWORD=\\$2a\\$12\\$your.hash.here\n' +
      'or pass ADMIN_PASSWORD as a real environment variable / secret mount instead.'
    );
  }

  if (!BCRYPT_HASH_PATTERN.test(raw)) {
    throw new Error(
      'ADMIN_PASSWORD must be a bcrypt hash, not a plaintext password. ' +
      'Every login silently fails with 401 otherwise, because bcrypt.compare() ' +
      'returns false for a malformed hash rather than raising. Generate one with:\n' +
      '  node -e "const b=require(\'bcryptjs\'); b.hash(\'your-password\',12).then(h=>console.log(h))"\n' +
      'Remember to escape every `$` as `\\$` if you store it in a .env file.'
    );
  }
  return raw;
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

/**
 * Structured audit record for anything an admin does that matters.
 *
 * Replaces the previous Telegram notifications. Telegram was a poor audit sink:
 * delivery was best-effort and its failures were swallowed (`.catch(console.error)`),
 * so the record of a fund-moving action could silently not exist; it put a third
 * party in the loop; and ADMIN_DEV_MODE suppressed it entirely.
 *
 * A single JSON line on stdout is picked up by CloudWatch (this deploys to AWS),
 * is queryable, cannot fail to "send", and is not suppressible by a dev flag.
 * Alerting is a CloudWatch metric filter / Sentry rule on top of it — the code's
 * job is to emit the fact reliably, not to decide who gets paged.
 */
export function auditLog(event: string, fields: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      level: 'audit',
      event,
      at: new Date().toISOString(),
      ...fields,
    })
  );
}

// Telegram has been removed entirely.
//
// It served two roles, and was the wrong tool for both:
//   - Second factor: it put a third party's uptime on the critical path of an
//     *emergency* panel — the one you reach for precisely when things are broken.
//     TOTP (lib/totp.ts) needs only the operator's phone.
//   - Audit trail: delivery was best-effort with swallowed failures, so the
//     record of a fund-moving action could silently fail to exist — and
//     ADMIN_DEV_MODE suppressed it outright. auditLog() emits a structured line
//     that cannot fail to send and is not suppressible.
//
// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are no longer read anywhere.

// De-dupes rate-limit alerts so a sustained attack (many blocked requests)
// records one audit line per window instead of one per blocked request.
// In-memory only — consistent with the single-instance requirement documented
// in lib/rate-limit.ts.
const rateLimitAlertSentAt = new Map<string, number>();

/**
 * Records the first time a given rate limit is hit within `windowMs`.
 *
 * Worth alerting on: because clientKey() collapses every direct client into one
 * 'direct' bucket unless ADMIN_TRUST_PROXY_HEADERS=true, a single admin failing
 * their password a few times locks out everyone else until the window expires.
 * Surfacing that lets operators tell a lockout apart from an attack.
 */
export function notifyRateLimitHit(context: string, key: string, windowMs: number) {
  const dedupeKey = `${context}:${key}`;
  const now = Date.now();
  const lastSentAt = rateLimitAlertSentAt.get(dedupeKey);
  if (lastSentAt && now - lastSentAt < windowMs) return;
  rateLimitAlertSentAt.set(dedupeKey, now);

  auditLog('ratelimit.hit', {
    context,
    key,
    windowMs,
    note: "If ADMIN_TRUST_PROXY_HEADERS is not 'true', all direct clients share one bucket.",
  });
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
    '[security] ADMIN_DEV_MODE is "true". This enables developer-only behaviour ' +
    '(e.g. MOCK_MARKETS in lib/solana.ts serves fake markets instead of reading the ' +
    'chain). auditLog() still emits normally — audit records are NOT suppressed. ' +
    'Never use this setting in production.'
  );
}
