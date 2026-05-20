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
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
