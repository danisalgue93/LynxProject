import { NextResponse } from 'next/server';
import { fetchPendingMarkets } from '@/lib/solana';
import { requireAdminSession } from '@/lib/session';

export async function GET() {
  try {
    await requireAdminSession();
    const markets = await fetchPendingMarkets();
    return NextResponse.json({ markets });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unauthorized';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
