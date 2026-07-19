import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { auditLog, clientKey, getAdminPasswordHash, notifyRateLimitHit, verifySecret } from '@/lib/security';
import { isTotpConfigured } from '@/lib/totp';

/**
 * First factor: the admin password.
 *
 * This route used to mint a random OTP, hash it into an in-memory store, and
 * deliver it over Telegram. That is gone: TOTP from the operator's authenticator
 * is now the only second factor (see verify-otp), so there is nothing to send —
 * the code already exists on their phone. The route's remaining job is to check
 * the password before the UI asks for the code.
 *
 * Removing the Telegram hop also removed the failure it caused: the response
 * header carried an em dash, which is not encodable in an HTTP header
 * (ByteString/latin-1), so with ADMIN_DEV_MODE=true this route threw and
 * answered 500 to *every* login attempt.
 */
export async function POST(req: NextRequest) {
  const key = clientKey(req);
  if (!rateLimit(`password:${key}`, 5, 15 * 60 * 1000)) {
    notifyRateLimitHit('password', key, 15 * 60 * 1000);
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { password } = body;

  // Throws with an actionable message if ADMIN_PASSWORD is missing, blanked by
  // .env `$` expansion, or stored as plaintext (see getAdminPasswordHash).
  const expected = getAdminPasswordHash();

  if (typeof password !== 'string' || !(await verifySecret(password, expected))) {
    auditLog('login.failed', { key, factor: 'password' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fail here rather than after the password is accepted: an admin panel with no
  // second factor must not be enterable at all.
  if (!isTotpConfigured()) {
    auditLog('login.misconfigured', { key, reason: 'ADMIN_TOTP_SECRET is not set' });
    return NextResponse.json(
      {
        error:
          'This panel has no second factor configured. Set ADMIN_TOTP_SECRET (see .env.example) before logging in.',
      },
      { status: 500 }
    );
  }

  auditLog('login.password_ok', { key });
  return NextResponse.json({ ok: true, factor: 'totp' });
}
