/**
 * Sentry instrumentation for the Lynx Market frontend.
 *
 * This file MUST be imported before any other import in main.tsx so that
 * Sentry can instrument React, Router, and third-party libraries.
 *
 * Required env vars:
 *   VITE_SENTRY_DSN  — Sentry DSN (found in Sentry project → Settings → SDK Setup)
 *
 * Source maps are uploaded during `npm run build` when SENTRY_AUTH_TOKEN is set.
 */

import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN;

// Only initialise when a DSN is provided.
// In development without a DSN, Sentry is a no-op so there is no performance
// overhead and no console noise.
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,           // 'production' | 'development'
    release: import.meta.env.VITE_APP_VERSION,   // optional: set in CI with git SHA

    // Capture 100% of transactions in production for now.
    // Lower this to e.g. 0.1 (10%) once you have baseline traffic data.
    tracesSampleRate: 1.0,

    // Replay captures 10% of sessions, 100% when an error occurs.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],

    // Strip sensitive query params from URLs before they're sent to Sentry
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data?.url) {
        try {
          const url = new URL(breadcrumb.data.url as string);
          url.searchParams.delete('wallet');
          url.searchParams.delete('verify');
          url.searchParams.delete('reset');
          breadcrumb.data.url = url.toString();
        } catch {
          // ignore invalid URLs
        }
      }
      return breadcrumb;
    },
  });
}

export { Sentry };
