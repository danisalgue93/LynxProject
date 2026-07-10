import { NextRequest, NextResponse } from 'next/server';
import { deleteOtp, getOtp, setOtp } from '@/lib/otp-store';
import { rateLimit } from '@/lib/rate-limit';
import { clientKey, notifyRateLimitHit, verifySecret } from '@/lib/security';
import { getSession } from '@/lib/session';
import { verifyTotp, isTotpConfigured } from '@/lib/totp';

export async function POST(req: NextRequest) {
  const key = clientKey(req);
  if (!rateLimit(`otp:${key}`, 8, 15 * 60 * 1000)) {
    notifyRateLimitHit('otp', key, 15 * 60 * 1000);
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  const { otp } = await req.json();
  if (typeof otp !== 'string') {
    return NextResponse.json({ error: 'Invalid OTP' }, { status: 401 });
  }

  // Segundo factor de respaldo (M5 de la auditoria): si este admin tiene
  // configurado ADMIN_TOTP_SECRET, un codigo de 6 digitos de su app de
  // autenticacion es valido incluso si Telegram no esta disponible o el OTP
  // por Telegram ya expiro. No consume ni depende del estado de otp-store.
  if (isTotpConfigured() && verifyTotp(process.env.ADMIN_TOTP_SECRET!, otp)) {
    // AP-10: Session rotation on login — destroy old session and create fresh one
    deleteOtp(key);

    // Destroy old session to prevent session fixation
    const oldSession = await getSession();
    await oldSession.destroy();

    // Create fresh session with admin identity
    const newSession = await getSession();
    newSession.admin = true;
    newSession.adminId = key;
    newSession.adminWallet = process.env.ADMIN_KEYPAIR_BS58 ? 'configured' : 'missing';
    newSession.loginAt = Date.now();
    newSession.activityAt = Date.now();
    await newSession.save();
    return NextResponse.json({ ok: true, via: 'totp' });
  }

  const pending = getOtp(key);

  if (!pending || Date.now() > pending.expiresAt) {
    deleteOtp(key);
    return NextResponse.json({ error: 'OTP expired' }, { status: 401 });
  }

  if (pending.attempts >= 8 || !(await verifySecret(otp, pending.hash))) {
    pending.attempts += 1;
    if (pending.attempts >= 8) {
      deleteOtp(key);
      return NextResponse.json({ error: 'Too many failed attempts. Request a new OTP.' }, { status: 401 });
    }
    setOtp(key, pending);
    return NextResponse.json({ error: 'Invalid OTP' }, { status: 401 });
  }

  deleteOtp(key);

  // Destroy old session to prevent session fixation
  const oldSession = await getSession();
  await oldSession.destroy();

  // Create fresh session with admin identity
  const session = await getSession();
  session.admin = true;
  session.adminId = key;
  session.adminWallet = process.env.ADMIN_KEYPAIR_BS58 ? 'configured' : 'missing';
  session.loginAt = Date.now();
  session.activityAt = Date.now();
  await session.save();

  return NextResponse.json({ ok: true, via: 'telegram' });
}
