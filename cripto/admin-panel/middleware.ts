import { NextRequest, NextResponse } from 'next/server';

function isAllowedHost(host: string | null) {
  const allowed = (process.env.ADMIN_ALLOWED_HOSTS ?? 'localhost:3001,127.0.0.1:3001')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return host ? allowed.includes(host.toLowerCase()) : false;
}

export function middleware(req: NextRequest) {
  if (!isAllowedHost(req.headers.get('host'))) {
    return new NextResponse('Forbidden host', { status: 403 });
  }

  const res = NextResponse.next();
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Strict CSP for admin panel — no external resources allowed
  res.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';"
  );
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
