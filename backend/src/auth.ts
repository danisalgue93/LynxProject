// Backend JWT + password-hashing helpers.
//
// NOTE: this file used to contain a stray copy of the FRONTEND'S
// localStorage-based session helper (frontend/src/lib/auth.ts), which is a
// browser-only module and cannot run on the server (it imports 'react' and
// touches window.localStorage). That code has been removed from here; the
// real, still-correct version continues to live in
// frontend/src/lib/auth.ts and is untouched.
//
// This module implements the seven functions server.ts actually imports
// from './auth.js', with the exact call signatures used at every call site:
//   - generateToken({ userId, email, role })              -> access JWT
//   - generateRefreshToken(userId)                          -> refresh JWT
//   - verifyToken(token)                                    -> payload | null
//   - verifyRefreshToken(token)                             -> payload | null
//   - hashPassword(password)                                -> Promise<string>
//   - hashPasswordSync(password)                             -> string
//   - verifyPassword(password, hash)                        -> Promise<boolean>
//   - extractToken(authorizationHeader)                     -> string | null

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Secrets are required in production (server.ts's start() already throws
// before listen() if JWT_SECRET / REFRESH_SECRET are missing in
// NODE_ENV=production). These fallbacks only matter for local dev/tests,
// where no .env file is guaranteed to exist.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'dev-refresh-secret-change-in-production';

// jsonwebtoken's `expiresIn` option wants a number of seconds (or a
// template-literal "StringValue" type like `15m`/`7d` that's awkward to
// build from an arbitrary env string). Parsing JWT_EXPIRY/REFRESH_EXPIRY
// into a plain number of seconds ourselves sidesteps that and mirrors the
// same "<number><unit>" format server.ts already parses for the refresh
// cookie's maxAge via parseDurationMs.
function parseExpirySeconds(value: string | undefined, fallbackSeconds: number): number {
  if (!value) return fallbackSeconds;
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };
  return amount * multipliers[unit];
}

const JWT_EXPIRY_SECONDS = parseExpirySeconds(process.env.JWT_EXPIRY, 15 * 60); // 15m default
const REFRESH_EXPIRY_SECONDS = parseExpirySeconds(process.env.REFRESH_EXPIRY, 7 * 24 * 60 * 60); // 7d default

const BCRYPT_SALT_ROUNDS = 10;

export type AccessTokenPayload = {
  userId: string;
  email: string;
  role: string;
};

export type RefreshTokenPayload = {
  userId: string;
};

// Short-lived access token. Callers pass the full payload object, e.g.
// generateToken({ userId: user.id, email: user.email, role: user.role }).
export function generateToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY_SECONDS });
}

// Long-lived refresh token. Only the userId is embedded — role/email can
// change between issuance and use, so callers re-derive them from the live
// user record after verifying this token rather than trusting stale claims.
export function generateRefreshToken(userId: string): string {
  const payload: RefreshTokenPayload = { userId };
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY_SECONDS });
}

// Returns the decoded payload, or null if the token is missing, expired,
// malformed, signed with the wrong secret, or missing an expected field.
// Never throws — callers rely on a falsy return to mean "not authenticated".
export function verifyToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === 'string') return null;
    const { userId, email, role } = decoded as jwt.JwtPayload & Partial<AccessTokenPayload>;
    if (!userId || !email || !role) return null;
    return { userId, email, role };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET);
    if (typeof decoded === 'string') return null;
    const { userId } = decoded as jwt.JwtPayload & Partial<RefreshTokenPayload>;
    if (!userId) return null;
    return { userId };
  } catch {
    return null;
  }
}

// Async hashing for request-handling code paths (registration, password
// change/reset) so the event loop isn't blocked by bcrypt's CPU-bound work.
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

// Sync variant for call sites that run before the server starts accepting
// requests (e.g. seeding an admin user at boot), where blocking briefly is
// harmless and awaiting an extra microtask isn't worth the complexity.
export function hashPasswordSync(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Pulls the token out of a `Authorization: Bearer <token>` header.
// Returns null for a missing header, wrong scheme, or empty token.
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}
