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

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version,

    // Capture 100% of transactions. Reduce after collecting baseline data.
    tracesSampleRate: 1.0,

    // Scrub sensitive fields before sending to Sentry
    beforeSend(event) {
      // Strip password hashes and JWT payloads from request bodies
      if (event.request?.data && typeof event.request.data === 'object') {
        const data = event.request.data as Record<string, unknown>;
        for (const key of ['password', 'passwordHash', 'signature', 'token', 'refreshToken']) {
          if (key in data) data[key] = '[Filtered]';
        }
      }
      return event;
    },
  });
}

export { Sentry };
