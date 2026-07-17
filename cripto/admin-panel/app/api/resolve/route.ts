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
  getAdminPubkey,
  type OutcomeName,
} from '@/lib/solana';
import { auditLog, clientKey, notifyRateLimitHit } from '@/lib/security';

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
// ⚠️ MODELO DE DESPLIEGUE (hallazgo C-05) — no es opcional:
// Cada admin del multisig ejecuta SU PROPIA instancia de este panel, en SU
// PROPIO host, con SU PROPIA ADMIN_KEYPAIR_BS58. Una sola instancia no puede
// completar el flujo por si misma: propose_action registra al proponente como
// aprobacion #0 y approve_action rechaza on-chain una segunda aprobacion de esa
// misma clave, asi que "approve" SIEMPRE falla sobre una propuesta creada aqui.
// Eso es correcto, no un bug: un 2-de-2 solo protege si las dos firmas viven en
// dos sitios distintos. Cargar las dos claves en un mismo panel lo convertiria
// en un 1-de-1 (un host comprometido = ambas firmas) y anularia toda la defensa.
// GET /api/resolve anota cada propuesta con `canApproveHere` para que la UI solo
// ofrezca lo que la clave de ESTA instancia puede hacer de verdad.
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

    // Which deployment (i.e. which of the two multisig admins) took the action.
    // Recorded on every audit line so the trail attributes each step to a signer
    // rather than to an anonymous "the admin panel".
    let panelSigner: string | null = null;
    try {
      panelSigner = getAdminPubkey();
    } catch {
      panelSigner = null;
    }

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
      auditLog('resolve.propose', { market: marketPubkey, result, proposalPubkey, signature, panelSigner });
      return NextResponse.json({ ok: true, signature, proposalPubkey });
    }

    if (action === 'approve') {
      const { proposalPubkey } = body;
      if (typeof proposalPubkey !== 'string') {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      const signature = await approveProposal(proposalPubkey);
      auditLog('resolve.approve', { proposalPubkey, signature, panelSigner });
      return NextResponse.json({ ok: true, signature });
    }

    if (action === 'execute') {
      const { proposalPubkey, marketPubkey } = body;
      if (typeof proposalPubkey !== 'string' || typeof marketPubkey !== 'string') {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      // This is the call that actually moves funds.
      const signature = await executeResolveMarketAdmin(proposalPubkey, marketPubkey);
      auditLog('resolve.execute', { market: marketPubkey, proposalPubkey, signature, panelSigner, movesFunds: true });
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
      auditLog('resolve.dispute', { market: marketPubkey, signature, panelSigner });
      return NextResponse.json({ ok: true, signature });
    }

    // finalize
    {
      const { marketPubkey } = body;
      if (typeof marketPubkey !== 'string') {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      // Also moves funds (fees to treasury / rewards vault).
      const signature = await finalizeResolution(marketPubkey);
      auditLog('resolve.finalize', { market: marketPubkey, signature, panelSigner, movesFunds: true });
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
    // Which signer this deployment is. Each admin runs their own panel with their
    // own key, so the UI must show whose panel this is — otherwise an operator
    // cannot tell why a proposal is approvable here but not there.
    let thisPanelSigner: string | null = null;
    try {
      thisPanelSigner = getAdminPubkey();
    } catch {
      thisPanelSigner = null;
    }
    return NextResponse.json({ proposals, thisPanelSigner });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list proposals';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
