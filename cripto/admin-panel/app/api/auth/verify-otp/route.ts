import { NextRequest, NextResponse } from 'next/server';
import { deleteOtp, getOtp, setOtp } from '@/lib/otp-store';
import { rateLimit } from '@/lib/rate-limit';
import { clientKey, hashSecret, timingSafeEqualText } from '@/lib/security';
import { getSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const key = clientKey(req);
  if (!rateLimit(`otp:${key}`, 8, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  const { otp } = await req.json();
  const pending = getOtp(key);

  if (!pending || Date.now() > pending.expiresAt || typeof otp !== 'string') {
    deleteOtp(key);
    return NextResponse.json({ error: 'OTP expired' }, { status: 401 });
  }

  if (pending.attempts >= 3 || !timingSafeEqualText(hashSecret(otp), pending.hash)) {
    pending.attempts += 1;
    setOtp(key, pending);
    return NextResponse.json({ error: 'Invalid OTP' }, { status: 401 });
  }

  deleteOtp(key);
  const session = await getSession();
  session.admin = true;
  session.loginAt = Date.now();
  await session.save();

  return NextResponse.json({ ok: true });
}
