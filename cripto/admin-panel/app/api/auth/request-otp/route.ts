import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { setOtp } from '@/lib/otp-store';
import { rateLimit } from '@/lib/rate-limit';
import { assertEnv, clientKey, hashSecret, isDevMode, sendTelegram, timingSafeEqualText } from '@/lib/security';

export async function POST(req: NextRequest) {
  const key = clientKey(req);
  if (!rateLimit(`password:${key}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  const { password } = await req.json();
  const expected = assertEnv('ADMIN_PASSWORD');

  if (typeof password !== 'string' || !timingSafeEqualText(hashSecret(password), hashSecret(expected))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const otp = crypto.randomInt(100_000, 1_000_000).toString();
  setOtp(key, {
    hash: hashSecret(otp),
    expiresAt: Date.now() + 5 * 60 * 1000,
    attempts: 0,
  });

  await sendTelegram(`*Lynx emergency admin*\n\nOTP: \`${otp}\`\nExpires in 5 minutes.\nIP key: \`${key}\``);

  return NextResponse.json({ ok: true, devOtp: isDevMode() ? otp : undefined });
}
