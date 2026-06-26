import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const DEFAULT_JWT_SECRET = 'dev-secret-key-change-in-production';
const DEFAULT_REFRESH_SECRET = 'dev-refresh-secret-key-change-in-production';
const JWT_SECRET: string = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const JWT_EXPIRY: string = process.env.JWT_EXPIRY || '15m';
const REFRESH_SECRET: string = process.env.REFRESH_SECRET || DEFAULT_REFRESH_SECRET;
const REFRESH_EXPIRY: string = process.env.REFRESH_EXPIRY || '7d';

// Fail fast in production if the secret is the insecure default or missing
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error('JWT_SECRET must be set to a secure value in production. Do not use the default.');
}
if (process.env.NODE_ENV === 'production' && REFRESH_SECRET === DEFAULT_REFRESH_SECRET) {
  throw new Error('REFRESH_SECRET must be set to a secure value in production. Do not use the default.');
}

export interface AuthPayload {
  userId: string;
  email: string;
  role?: 'admin' | 'user';
}

export interface RefreshPayload {
  userId: string;
  type: 'refresh';
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export function hashPasswordSync(password: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY } as any);
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: 'refresh' }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY } as any);
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded as AuthPayload;
  } catch (err) {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshPayload | null {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET) as any;
    if (decoded?.type !== 'refresh') return null;
    return decoded as RefreshPayload;
  } catch (err) {
    return null;
  }
}

export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
