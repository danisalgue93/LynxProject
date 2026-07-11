import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { requireAdminSession } from '@/lib/session';
import {
  proposeResolveMarketAdmin,
  approveProposal,
  executeResolveMarketAdmin,
  disputeResolution,
  finalizeResolution,
  fetchOpenProposals,
  fetchPendingMarkets,
  type OutcomeName,
} from '@/lib/solana';
import { clientKey, escapeMarkdown, notifyRateLimitHit, sendTelegram } from '@/lib/security';

const OUTCOMES = new Set(['Yes', 'No', 'Draw']);
const ACTIONS = new Set(['propose', 'approve', 'execute', 'dispute', 'finalize']);

// CSRF protection is provided by design: all state-modifying requests require an
// authenticated admin session stored in an httpOnly + sameSite:'strict' cookie.
// The browser automatically includes this cookie on same-origin requests but
// strips it on cross-origin requests, preventing CSRF attacks without a
// separate token. This is sufficient for a same-origin admin panel.
//
// Antes esta ruta ejecutaba resolve_market_admin al instante con una sola
// firma. Ahora es un flujo de gobernanza de varios pasos (multisig 2-de-2 +
// ventana de disputa de 24h), acorde al hallazgo C3 del informe de auditoria:
// ningun fondo se mueve hasta que dos admins distintos lo han aprobado
// (accion "propose" + "approve") Y ha pasado el timelock de ejecucion
// (accion "execute"), o hasta que pasa la ventana de disputa sin objeciones
// tras una propuesta del oraculo (accion "finalize").
//
// body esperado segun `action`:
//   propose:  { action: 'propose', marketPubkey, result, confirmation }
//   approve:  { action: 'approve', proposalPubkey }
//   execute:  { action: 'execute', proposalPubkey, marketPubkey }
//   dispute:  { action: 'dispute', marketPubkey, confirmation }
//   finalize: { action: 'finalize', marketPubkey }
export async function POST(req: NextRequest) {
  try {
    await requireAdminSession();

    const key = clientKey(req);
    if (!rateLimit(`resolve:${key}`, 10, 60 * 60 * 1000)) {
      notifyRateLimitHit('resolve', key, 60 * 60 * 1000);
      return NextResponse.json({ error: 'Too many resolve attempts' }, { status: 429 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { action } = body;
    if (typeof action !== 'string' || !ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    if (action === 'propose') {
      const { marketPubkey, result, confirmation } = body;
      if (typeof marketPubkey !== 'string' || !OUTCOMES.has(result)) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      if (confirmation !== `PROPOSE ${result}`) {
        return NextResponse.json({ error: `Type PROPOSE ${result} to confirm` }, { status: 400 });
      }

      // AP-26: Server-side validation — oracle_deadline must have passed
      const markets = await fetchPendingMarkets();
      const market = markets.find((m) => m.pubkey === marketPubkey);
      if (!market) {
        return NextResponse.json({ error: 'Market not found in pending list' }, { status: 404 });
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (market.oracleDeadline > nowSec) {
        return NextResponse.json(
          { error: `Oracle deadline has not passed yet (deadline: ${market.oracleDeadline}, now: ${nowSec}). Wait ${market.oracleDeadline - nowSec}s.` },
          { status: 400 }
        );
      }

      const { signature, proposalPubkey } = await proposeResolveMarketAdmin(marketPubkey, result as OutcomeName);
      sendTelegram(
        `*Lynx: nueva propuesta de resolucion (fallback admin)*\n\nMercado: \`${escapeMarkdown(marketPubkey)}\`\nResultado propuesto: *${escapeMarkdown(result)}*\nProposal: \`${escapeMarkdown(proposalPubkey)}\`\nTx: \`${escapeMarkdown(signature)}\`\n\nHace falta la aprobacion del OTRO admin antes de poder ejecutarla.`
      ).catch((err: unknown) => console.error('[resolve/propose] Telegram failed:', err instanceof Error ? err.message : err));
      return NextResponse.json({ ok: true, signature, proposalPubkey });
    }

    if (action === 'approve') {
      const { proposalPubkey } = body;
      if (typeof proposalPubkey !== 'string') {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      const signature = await approveProposal(proposalPubkey);
      sendTelegram(`*Lynx: propuesta aprobada*\n\nProposal: \`${escapeMarkdown(proposalPubkey)}\`\nTx: \`${escapeMarkdown(signature)}\``).catch(
        (err: unknown) => console.error('[resolve/approve] Telegram failed:', err instanceof Error ? err.message : err)
      );
      return NextResponse.json({ ok: true, signature });
    }

    if (action === 'execute') {
      const { proposalPubkey, marketPubkey } = body;
      if (typeof proposalPubkey !== 'string' || typeof marketPubkey !== 'string') {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      const signature = await executeResolveMarketAdmin(proposalPubkey, marketPubkey);
      sendTelegram(
        `*Lynx: resolucion ejecutada (fallback admin)*\n\nMercado: \`${escapeMarkdown(marketPubkey)}\`\nTx: \`${escapeMarkdown(signature)}\``
      ).catch((err: unknown) => console.error('[resolve/execute] Telegram failed (TX was confirmed):', err instanceof Error ? err.message : err));
      return NextResponse.json({ ok: true, signature });
    }

    if (action === 'dispute') {
      const { marketPubkey, confirmation } = body;
      if (typeof marketPubkey !== 'string') {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      if (confirmation !== 'DISPUTE') {
        return NextResponse.json({ error: 'Type DISPUTE to confirm' }, { status: 400 });
      }
      const signature = await disputeResolution(marketPubkey);
      sendTelegram(
        `*Lynx: resolucion propuesta por el oraculo DISPUTADA*\n\nMercado: \`${escapeMarkdown(marketPubkey)}\`\nTx: \`${escapeMarkdown(signature)}\`\n\nEl mercado vuelve a CutOff. Hara falta una nueva propuesta del oraculo o el fallback admin (multisig) una vez pase oracle_deadline.`
      ).catch((err: unknown) => console.error('[resolve/dispute] Telegram failed:', err instanceof Error ? err.message : err));
      return NextResponse.json({ ok: true, signature });
    }

    // finalize
    {
      const { marketPubkey } = body;
      if (typeof marketPubkey !== 'string') {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      const signature = await finalizeResolution(marketPubkey);
      sendTelegram(
        `*Lynx: resolucion finalizada (ventana de disputa pasada sin objeciones)*\n\nMercado: \`${escapeMarkdown(marketPubkey)}\`\nTx: \`${escapeMarkdown(signature)}\``
      ).catch((err: unknown) => console.error('[resolve/finalize] Telegram failed (TX was confirmed):', err instanceof Error ? err.message : err));
      return NextResponse.json({ ok: true, signature });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Resolve failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  try {
    await requireAdminSession();
    const proposals = await fetchOpenProposals();
    return NextResponse.json({ proposals });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list proposals';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
