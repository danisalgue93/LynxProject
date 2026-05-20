import { NextResponse } from 'next/server';
import { fetchPendingMarkets } from '@/lib/solana';
import { requireAdminSession } from '@/lib/session';

export async function GET() {
  try {
    await requireAdminSession();
    const markets = await fetchPendingMarkets();
    return NextResponse.json({ markets });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Unauthorized' }, { status: 401 });
  }
}
