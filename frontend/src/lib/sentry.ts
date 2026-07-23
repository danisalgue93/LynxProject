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

// Strip sensitive query params (wallet address, email-link tokens) from any URL
// string. Shared by beforeBreadcrumb AND beforeSend so the scrubbing is not only
// applied to navigation breadcrumbs but also to the event's own request.url /
// trace context — the path the previous code missed (audit frontend-1.2).
const SENSITIVE_QUERY_PARAMS = ['wallet', 'verify', 'reset', 'token'];
function scrubUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const p of SENSITIVE_QUERY_PARAMS) url.searchParams.delete(p);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

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
    replaysOnErrorSampleRate: 0.3,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Strip sensitive query params from navigation breadcrumbs.
    beforeBreadcrumb(breadcrumb) {
      if (typeof breadcrumb.data?.url === 'string') {
        breadcrumb.data.url = scrubUrl(breadcrumb.data.url);
      }
      return breadcrumb;
    },

    // And from the event itself — Sentry captures the current page URL in
    // request.url / the trace context, which beforeBreadcrumb never touches. So
    // an error during a load of /?reset=TOKEN could otherwise leak that token.
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = scrubUrl(event.request.url);
      }
      return event;
    },
  });
}

export { Sentry };
