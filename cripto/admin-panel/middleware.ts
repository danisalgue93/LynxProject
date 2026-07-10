import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from './lib/session';
import { rateLimit } from './lib/rate-limit';

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

  // AP-21: Rate limit all requests (30 req/15min — admin panel is low-traffic)
  // AP-20: In-memory rate limiting is acceptable for single-instance admin panel
  if (!rateLimit('global', 30, 15 * 60 * 1000)) {
    return new NextResponse('Too many requests', { status: 429 });
  }

  const { pathname } = req.nextUrl;

  // AP-05: Verify admin session for protected paths
  // Auth routes (login, request-otp, verify-otp) are exempt
  const isAuthRoute = pathname.startsWith('/api/auth/');
  const isLoginPage = pathname === '/login';
  const isPublicAsset = pathname.startsWith('/_next/') || pathname === '/favicon.ico';

  if (!isAuthRoute && !isLoginPage && !isPublicAsset) {
    try {
      await requireAdminSession();
    } catch {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }

  const res = NextResponse.next();

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
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';" // Note: script-src 'unsafe-inline' is required by Next.js App Router hydration.
    // To remove it, implement nonce-based CSP per https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
  );
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};