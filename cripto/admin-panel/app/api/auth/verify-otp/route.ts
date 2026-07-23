import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { auditLog, clientKey, notifyRateLimitHit } from '@/lib/security';
import { getSession, PRE_AUTH_TTL_MS } from '@/lib/session';
import { verifyTotp, isTotpConfigured } from '@/lib/totp';

/**
 * Second factor: a TOTP code from the admin's authenticator app.
 *
 * TOTP is now the ONLY second factor. It previously sat behind a Telegram-
 * delivered OTP, with TOTP as a fallback — which put a third-party service
 * (their bot, their API, their uptime) on the critical path of an emergency
 * admin panel. The panel exists precisely for moments when things are going
 * wrong; depending on Telegram being reachable at that moment is backwards.
 * TOTP needs nothing but the operator's phone and a correct clock.
 *
 * The Telegram OTP path, its in-memory otp-store, and the per-attempt hashing
 * around it are gone with it.
 */
export async function POST(req: NextRequest) {
  const key = clientKey(req);
  if (!rateLimit(`otp:${key}`, 8, 15 * 60 * 1000)) {
    notifyRateLimitHit('otp', key, 15 * 60 * 1000);
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { otp } = body;
  if (typeof otp !== 'string') {
    return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
  }

  if (!isTotpConfigured()) {
    // Refuse rather than fall through to a weaker factor: an admin panel with no
    // second factor configured must not be loggable into at all.
    auditLog('login.misconfigured', { key, reason: 'ADMIN_TOTP_SECRET is not set' });
    return NextResponse.json(
      {
        error:
          'This panel has no second factor configured. Set ADMIN_TOTP_SECRET (see .env.example) before logging in.',
      },
      { status: 500 }
    );
  }

  // First factor must have been proven in THIS login sequence (audit cripto-H1):
  // request-otp sets a short-lived preAuth flag after the password check. Without
  // it, a leaked TOTP secret alone would be enough to enter the panel.
  const preAuthSession = await getSession();
  const preAuthOk =
    preAuthSession.preAuth === true &&
    typeof preAuthSession.preAuthAt === 'number' &&
    Date.now() - preAuthSession.preAuthAt < PRE_AUTH_TTL_MS;
  if (!preAuthOk) {
    await preAuthSession.destroy();
    auditLog('login.failed', { key, factor: 'totp', reason: 'missing_or_expired_password_factor' });
    return NextResponse.json({ error: 'Password step required first' }, { status: 401 });
  }

  // Consumes the matching counter, so a captured code cannot be replayed within
  // its remaining validity window (see verifyTotp).
  if (!verifyTotp(process.env.ADMIN_TOTP_SECRET!, otp)) {
    auditLog('login.failed', { key, factor: 'totp' });
    return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
  }

  // AP-10: rotate the session on login — destroy any existing one first so a
  // pre-set cookie (including the preAuth one) cannot be fixated onto the
  // authenticated session.
  const oldSession = await getSession();
  await oldSession.destroy();

  const session = await getSession();
  session.admin = true;
  session.adminId = key;
  session.adminWallet = process.env.ADMIN_KEYPAIR_BS58 ? 'configured' : 'missing';
  session.loginAt = Date.now();
  session.activityAt = Date.now();
  await session.save();

  auditLog('login.success', { key, factor: 'totp' });
  return NextResponse.json({ ok: true, via: 'totp' });
}
