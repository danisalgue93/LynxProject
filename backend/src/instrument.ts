/**
 * Sentry instrumentation for the Lynx Market backend.
 *
 * This file MUST be imported at the very top of server.ts (before Express
 * and all other imports) so Sentry can auto-instrument HTTP, DB, and async ops.
 *
 * Required env vars:
 *   SENTRY_DSN  — Sentry DSN (found in Sentry project → Settings → SDK Setup)
 */

import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

// Query params that must never reach Sentry. Several read routes take the
// wallet as a query string (/api/portfolio, /api/transactions, /api/positions,
// /api/notifications), and the email flows carry one-time tokens there.
const SENSITIVE_QUERY_PARAMS = ['wallet', 'token', 'verify', 'reset', 'signature'];
const SENSITIVE_BODY_KEYS = ['password', 'passwordHash', 'signature', 'signatureMessage', 'token', 'refreshToken'];
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'x-admin-token'];

function scrubUrl(rawUrl: string): string {
  try {
    // Tolerate relative URLs (Sentry sometimes reports just the path).
    const base = 'http://scrub.local';
    const url = new URL(rawUrl, base);
    let touched = false;
    for (const p of SENSITIVE_QUERY_PARAMS) {
      if (url.searchParams.has(p)) { url.searchParams.set(p, '[Filtered]'); touched = true; }
    }
    if (!touched) return rawUrl;
    return rawUrl.startsWith('http') ? url.toString() : `${url.pathname}${url.search}`;
  } catch {
    return rawUrl;
  }
}

// A malformed SENTRY_TRACES_SAMPLE_RATE used to become NaN and silently break
// trace sampling; clamp to a valid 0..1 rate with a sane default instead.
function tracesSampleRate(): number {
  const parsed = Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '');
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0.1;
  return parsed;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version,

    tracesSampleRate: tracesSampleRate(),

    // Scrub sensitive data before sending to Sentry.
    beforeSend(event) {
      // Request bodies: password hashes, wallet signatures, JWTs.
      if (event.request?.data && typeof event.request.data === 'object') {
        const data = event.request.data as Record<string, unknown>;
        for (const key of SENSITIVE_BODY_KEYS) {
          if (key in data) data[key] = '[Filtered]';
        }
      }
      // URL query string — previously unscrubbed, so wallet addresses and
      // email-link tokens travelled to Sentry in full.
      if (event.request?.url) {
        event.request.url = scrubUrl(event.request.url);
      }
      // Credentials in headers, in case sendDefaultPii is ever turned on.
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, string>;
        for (const name of Object.keys(headers)) {
          if (SENSITIVE_HEADERS.includes(name.toLowerCase())) headers[name] = '[Filtered]';
        }
      }
      return event;
    },
  });
}

export { Sentry };
