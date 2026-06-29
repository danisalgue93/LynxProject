import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { requireAdminSession } from '@/lib/session';
import { resolveMarketManually, type OutcomeName } from '@/lib/solana';
import { clientKey, sendTelegram } from '@/lib/security';

const OUTCOMES = new Set(['Yes', 'No', 'Draw']);

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession();

    const key = clientKey(req);
    if (!rateLimit(`resolve:${key}`, 3, 60 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many resolve attempts' }, { status: 429 });
    }

    const { marketPubkey, result, confirmation } = await req.json();
    if (typeof marketPubkey !== 'string' || !OUTCOMES.has(result)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    if (confirmation !== `RESOLVE ${result}`) {
      return NextResponse.json({ error: `Type RESOLVE ${result} to confirm` }, { status: 400 });
    }

    const signature = await resolveMarketManually(marketPubkey, result as OutcomeName);

    // Send Telegram notification async — resolution is committed on-chain already.
    // A Telegram failure must NOT cause a 400 response that misleads the admin into
    // thinking the resolution failed (which could trigger a duplicate resolution attempt).
    sendTelegram(
      `*Lynx manual resolution executed*\n\nMarket: \`${marketPubkey}\`\nResult: *${result}*\nTx: \`${signature}\``
    ).catch((err: any) =>
      console.error('[resolve] Telegram notification failed (TX was confirmed):', err?.message)
    );

    return NextResponse.json({ ok: true, signature });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Resolve failed' }, { status: 400 });
  }
}
