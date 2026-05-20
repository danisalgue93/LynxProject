import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export type AdminSession = {
  admin?: boolean;
  loginAt?: number;
};

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET ?? 'development-secret-must-be-replaced-32-chars',
  cookieName: 'lynx_admin_session',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60,
  },
};

export function getSession() {
  return getIronSession<AdminSession>(cookies(), sessionOptions);
}

export async function requireAdminSession() {
  const session = await getSession();
  if (!session.admin) {
    throw new Error('Unauthorized');
  }
  return session;
}
