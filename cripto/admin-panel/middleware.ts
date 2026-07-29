import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { sessionOptions, INACTIVITY_TIMEOUT_MS, type AdminSession } from './lib/session';
import { rateLimit } from './lib/rate-limit';
import { clientKey } from './lib/security';

function isAllowedHost(host: string | null) {
  const allowed = (process.env.ADMIN_ALLOWED_HOSTS ?? 'localhost:3001,127.0.0.1:3001')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return host ? allowed.includes(host.toLowerCase()) : false;
}

export async function middleware(req: NextRequest) {
  if (!isAllowedHost(req.headers.get('host'))) {
    return new NextResponse('Forbidden host', { status: 403 });
  }

  const { pathname } = req.nextUrl;

  // Static assets and the Next.js RSC/data payloads are fetched many times per
  // page view. Counting them against the request budget is what made the old
  // limit self-defeating.
  const isPublicAsset = pathname.startsWith('/_next/') || pathname === '/favicon.ico';

  // AP-21: coarse per-client request cap, as a backstop only. The real
  // brute-force protection lives on the auth routes themselves
  // (`otp:<key>` in request-otp/verify-otp), which stay deliberately strict.
  //
  // This used to use a single hardcoded 'global' bucket for EVERY request from
  // EVERY client at 60/15min. A normal admin session (page loads + polling)
  // burns that on its own, and any unauthenticated visitor could lock every
  // admin out of the panel for 15 minutes by sending 60 requests — a trivial
  // DoS of the exact tool needed to resolve a stuck market. Bucket per client
  // and skip assets so one client can never starve another.
  if (!isPublicAsset && !rateLimit(`req:${clientKey(req)}`, 600, 15 * 60 * 1000)) {
    return new NextResponse('Too many requests', { status: 429 });
  }

  // AP-05: Verify admin session for protected paths
  // Auth routes (login, request-otp, verify-otp) are exempt
  const isAuthRoute = pathname.startsWith('/api/auth/');
  const isLoginPage = pathname === '/login';

  const res = NextResponse.next();

  if (!isAuthRoute && !isLoginPage && !isPublicAsset) {
    // Read the session from THIS request/response pair.
    //
    // This used to call requireAdminSession(), which resolves the session via
    // cookies() from next/headers. That helper is for Server Components and
    // Route Handlers — in middleware it does not see the incoming request, so
    // the lookup found no session, threw, and the catch redirected to /login.
    // Every request bounced, including ones carrying a perfectly valid
    // lynx_admin_session cookie: after logging in successfully, /admin still
    // redirected to /login, so the panel could not be entered at all. The
    // symptom was indistinguishable from "not logged in", which is why it
    // survived — verified end to end against a production build.
    //
    // getIronSession(req, res, options) reads the cookie off the NextRequest and
    // writes any refresh onto the NextResponse we return below.
    const session = await getIronSession<AdminSession>(req, res, sessionOptions);

    if (!session.admin) {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    // Inactivity timeout, mirroring requireAdminSession(): a session idle for
    // longer than INACTIVITY_TIMEOUT_MS must re-authenticate.
    if (session.activityAt && Date.now() - session.activityAt > INACTIVITY_TIMEOUT_MS) {
      session.destroy();
      // Carry the session-clearing Set-Cookie (written by destroy() onto `res`)
      // on the redirect. Returning a fresh NextResponse.redirect here would drop
      // it, leaving the stale cookie in the browser (harmless — it keeps failing
      // the check — but the expired session should be cleared, not left dangling).
      const redirect = NextResponse.redirect(new URL('/login', req.url));
      res.headers.getSetCookie().forEach((cookie) => redirect.headers.append('set-cookie', cookie));
      return redirect;
    }

    // Sliding expiration: refresh the activity stamp on each authenticated hit.
    session.activityAt = Date.now();
    await session.save();
  }

  // AP-29: Security headers set here for direct Next.js access.
  // nginx also sets these for all proxied traffic. This duplication is
  // intentional and standard: nginx covers all traffic, middleware covers
  // direct access (e.g., local dev on port 3001).
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Strict CSP for admin panel — no external resources allowed
  res.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';" // Note: script-src 'unsafe-inline' is required by Next.js App Router hydration, and style-src 'unsafe-inline' by Next's injected styles + the panel's inline style props (buttons/layout). Styles cannot execute JS, so this does not weaken the XSS posture the way script-src would.
    // To remove it, implement nonce-based CSP per https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
  );
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};