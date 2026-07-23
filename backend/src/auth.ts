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

// Secrets are required in production (server.ts's start() also throws before
// listen() if JWT_SECRET / REFRESH_SECRET are missing when NODE_ENV=production).
//
// The dev fallbacks below are hardcoded and therefore PUBLIC — anyone reading
// this repo can forge tokens signed with them. They are only acceptable for
// local development (`npm run dev`, which sets no NODE_ENV) and the test suite.
// Previously they applied to ANY non-production value, so a deployment running
// with NODE_ENV=staging/preprod silently signed real sessions with a published
// secret *and* skipped start()'s required-vars check. Fail loudly instead.
const SAFE_FALLBACK_ENVS = new Set([undefined, '', 'development', 'test']);

function requireSecret(name: 'JWT_SECRET' | 'REFRESH_SECRET', devFallback: string): string {
  const configured = process.env[name];
  if (configured) return configured;
  if (SAFE_FALLBACK_ENVS.has(process.env.NODE_ENV)) return devFallback;
  throw new Error(
    `Missing required env var: ${name}. It only falls back to a built-in development ` +
    `value when NODE_ENV is unset, "development" or "test" — never for NODE_ENV=` +
    `"${process.env.NODE_ENV}", where that public constant would sign real sessions.`
  );
}

const JWT_SECRET = requireSecret('JWT_SECRET', 'dev-jwt-secret-change-in-production');
const REFRESH_SECRET = requireSecret('REFRESH_SECRET', 'dev-refresh-secret-change-in-production');

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
    // Pin the algorithm to what generateToken uses (HS256). jsonwebtoken v9
    // already rejects `alg:none` by default, but an explicit allowlist is the
    // defensive default and rules out any algorithm-confusion class outright.
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
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
    const decoded = jwt.verify(token, REFRESH_SECRET, { algorithms: ['HS256'] });
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
  // RFC 7235: the auth-scheme token is case-insensitive, so a client sending
  // "bearer <token>" is valid and must not be rejected as unauthenticated.
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
