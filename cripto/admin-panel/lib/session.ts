import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export type AdminSession = {
  admin?: boolean;
  adminId?: string;
  adminWallet?: string;
  loginAt?: number;
  activityAt?: number;
  // First-factor (password) proof, set by request-otp and required by verify-otp
  // so the TOTP secret alone cannot mint an admin session (audit cripto-H1).
  preAuth?: boolean;
  preAuthAt?: number;
};

// Pre-auth (password-verified, awaiting TOTP) validity window.
export const PRE_AUTH_TTL_MS = 5 * 60 * 1000;

// audit cripto-H2: the session cookie's `secure` flag must NOT silently depend
// on NODE_ENV — a deploy that forgets to set NODE_ENV=production would drop
// `secure` and allow the admin cookie over plain HTTP. Default to secure ALWAYS;
// only an explicit ADMIN_COOKIE_SECURE=false (for local http dev) turns it off.
function cookieSecure(): boolean {
  return process.env.ADMIN_COOKIE_SECURE !== 'false';
}

function sessionPassword() {
  const value = process.env.SESSION_SECRET;
  // iron-session requires a key of at least 32 characters; enforce it here so a
  // too-short secret fails loudly at import time with an actionable message,
  // rather than deep inside iron-session at the first request (audit B-N6).
  if (!value || value.length < 32) {
    throw new Error('Missing or too-short env var: SESSION_SECRET. Set it to a cryptographically random string of at least 32 characters.');
  }
  return value;
}

export const sessionOptions: SessionOptions = {
  password: sessionPassword(),
  cookieName: 'lynx_admin_session',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure(),
    maxAge: 60 * 60,
  },
};

export function getSession() {
  return getIronSession<AdminSession>(cookies(), sessionOptions);
}

// Inactivity timeout: 30 minutes of inactivity requires re-authentication.
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export async function requireAdminSession() {
  const session = await getSession();
  if (!session.admin) {
    throw new Error('Unauthorized');
  }
  // Check inactivity timeout
  if (session.activityAt && Date.now() - session.activityAt > INACTIVITY_TIMEOUT_MS) {
    await session.destroy();
    await session.save();
    throw new Error('Session expired due to inactivity');
  }
  // Sliding expiration: update activity timestamp on each authenticated request
  session.activityAt = Date.now();
  await session.save();
  return session;
}
