import { NextResponse } from 'next/server';
import { fetchPendingMarkets } from '@/lib/solana';
import { requireAdminSession } from '@/lib/session';

export async function GET() {
  // Auth failures are 401; a downstream RPC/decode failure must NOT be reported
  // as 401 (it looks like a session expiry and bounces the admin to /login for
  // a transient chain hiccup). Separate the two.
  try {
    await requireAdminSession();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unauthorized';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  try {
    const markets = await fetchPendingMarkets();
    return NextResponse.json({ markets });
  } catch (err: unknown) {
    console.error('[markets/pending] failed to read chain:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to read pending markets from the chain' }, { status: 502 });
  }
}
