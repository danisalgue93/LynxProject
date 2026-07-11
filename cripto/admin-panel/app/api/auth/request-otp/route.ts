import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { setOtp } from '@/lib/otp-store';
import { rateLimit } from '@/lib/rate-limit';
import { assertEnv, clientKey, escapeMarkdown, hashSecret, verifySecret, isDevMode, notifyRateLimitHit, sendTelegram } from '@/lib/security';

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
  const expected = assertEnv('ADMIN_PASSWORD');

  if (typeof password !== 'string' || !(await verifySecret(password, expected))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const otp = crypto.randomInt(100_000, 1_000_000).toString();
  setOtp(key, {
    hash: await hashSecret(otp),
    expiresAt: Date.now() + 5 * 60 * 1000,
    attempts: 0,
  });

  await sendTelegram(`*Lynx emergency admin*\n\nOTP: \`${escapeMarkdown(otp)}\`\nExpires in 5 minutes.\nIP key: \`${escapeMarkdown(key)}\``);

  const response = NextResponse.json({ ok: true });
  // AP-17: Only return dev OTP when ADMIN_DEV_MODE is explicitly 'true', with warning header
  if (isDevMode()) {
    response.headers.set('X-Dev-Warning', 'DEV MODE: OTP returned in response body — never enable ADMIN_DEV_MODE in production');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    const body = await response.json();
    return NextResponse.json({ ...body, devOtp: otp }, {
      headers: response.headers,
    });
  }
  return response;
}
