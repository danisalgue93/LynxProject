'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

type Market = {
  pubkey: string;
  id: string;
  title: string;
  oracleAuthority: string;
  status: string;
  oracleDeadline: number;
  poolTotal: string;
  yesTotal: string;
  noTotal: string;
  proposedResult: string;
  proposedTs: number;
};

type Proposal = {
  pubkey: string;
  proposer: string;
  proposalId: string;
  actionVariant: number;
  actionMarket?: string;
  actionResult?: string;
  approvals: string[];
  approvalCount: number;
  thresholdReachedTs: number;
  executed: boolean;
  cancelled: boolean;
  createdTs: number;
  expiresTs: number;
};

type Outcome = 'Yes' | 'No' | 'Draw';

function lamportsToSol(value: string): string {
  const lamports = BigInt(value);
  const sol = lamports / 10_000_000_000n;
  const remainder = lamports % 10_000_000_000n;
  const decimals = remainder.toString().padStart(9, '0').slice(0, 4);
  return `${sol}.${decimals}`;
}

export default function AdminPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signature, setSignature] = useState('');

  // AP-06: Periodic refresh every 30 seconds to keep "Ready" indicator accurate
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [marketsRes, proposalsRes] = await Promise.all([
        fetch('/api/markets/pending'),
        fetch('/api/resolve'),
      ]);
      if (marketsRes.status === 401 || proposalsRes.status === 401) {
        window.location.href = '/login';
        return;
      }
      const marketsData = await marketsRes.json();
      const proposalsData = await proposalsRes.json();
      if (!marketsRes.ok) throw new Error(marketsData.error || 'Failed to load markets');
      if (!proposalsRes.ok) throw new Error(proposalsData.error || 'Failed to load proposals');
      setMarkets(marketsData.markets);
      setProposals(proposalsData.proposals);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Separate proposals into open (need approval) and approved (ready for execution)
  // A proposal that has the ResolveMarketAdmin action variant (5)
  const resolveProposals = useMemo(
    () => proposals.filter(p => p.actionVariant === 5),
    [proposals]
  );

  const openProposals = useMemo(
    () => resolveProposals.filter(p => !p.executed && !p.cancelled),
    [resolveProposals]
  );

  // Markets in PendingResolution that were proposed by the oracle (not via governance)
  // These can be disputed or finalized
  const oracleProposedMarkets = useMemo(
    () => markets.filter(m => m.status === 'PendingResolution' && m.proposedResult !== 'Unresolved'),
    [markets]
  );

  // CutOff markets that don't have an active governance proposal
  const cutOffMarkets = useMemo(
    () => markets.filter(m => m.status === 'CutOff'),
    [markets]
  );

  async function proposeResolution(market: Market, result: Outcome) {
    const confirmation = prompt(`Type PROPOSE ${result} to confirm`);
    if (confirmation !== `PROPOSE ${result}`) return;

    setError('');
    setSignature('');
    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'propose', marketPubkey: market.pubkey, result, confirmation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Propose failed');
      setSignature(data.signature);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function approveProposalAction(proposal: Proposal) {
    if (!confirm(`Approve proposal ${proposal.pubkey.slice(0, 8)}...?`)) return;

    setError('');
    setSignature('');
    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', proposalPubkey: proposal.pubkey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Approve failed');
      setSignature(data.signature);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function executeProposal(proposal: Proposal) {
    if (!proposal.actionMarket) return;
    if (!confirm(`Execute proposal ${proposal.pubkey.slice(0, 8)}...? This will move funds.`)) return;

    setError('');
    setSignature('');
    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'execute', proposalPubkey: proposal.pubkey, marketPubkey: proposal.actionMarket }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Execute failed');
      setSignature(data.signature);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function disputeMarket(market: Market) {
    const confirmation = prompt('Type DISPUTE to confirm');
    if (confirmation !== 'DISPUTE') return;

    setError('');
    setSignature('');
    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dispute', marketPubkey: market.pubkey, confirmation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Dispute failed');
      setSignature(data.signature);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function finalizeMarket(market: Market) {
    if (!confirm(`Finalize resolution for ${market.title}? The dispute window has passed.`)) return;

    setError('');
    setSignature('');
    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finalize', marketPubkey: market.pubkey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Finalize failed');
      setSignature(data.signature);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const isMarketReady = (market: Market) => Math.floor(Date.now() / 1000) >= market.oracleDeadline;

  return (
    <main className="shell">
      <section className="panel">
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Governance Admin</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              Propose, approve, execute, dispute, and finalize market resolutions via multisig governance.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={loadData} style={secondaryButtonStyle}>Refresh</button>
            <button onClick={logout} style={secondaryButtonStyle}>Logout</button>
          </div>
        </header>

        {signature && (
          <div className="card" style={{ padding: 16, marginTop: 22, borderColor: '#059669' }}>
            <strong className="success">Transaction sent.</strong>
            <p style={{ marginBottom: 0, wordBreak: 'break-all' }}>{signature}</p>
          </div>
        )}

        {error && (
          <div className="card" style={{ padding: 16, marginTop: 22, borderColor: '#dc2626' }}>
            <strong className="danger">{error}</strong>
          </div>
        )}

        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Loading...</p>
        ) : (
          <div style={{ display: 'grid', gap: 22, marginTop: 24 }}>
            {/* Section 1: Pending markets needing governance proposal */}
            <Section title={`Pending Markets (${cutOffMarkets.length})`} subtitle="Markets in CutOff state. Propose a resolution once oracle timeout has passed.">
              {cutOffMarkets.length === 0 ? (
                <p className="muted">No CutOff markets pending resolution.</p>
              ) : (
                cutOffMarkets.map(market => (
                  <MarketRow key={market.pubkey} market={market} ready={isMarketReady(market)}>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <select id={`outcome-${market.pubkey}`} style={inputStyle}>
                        <option value="Yes">YES</option>
                        <option value="No">NO</option>
                        <option value="Draw">DRAW</option>
                      </select>
                      <button
                        disabled={!isMarketReady(market)}
                        onClick={() => {
                          const select = document.getElementById(`outcome-${market.pubkey}`) as HTMLSelectElement;
                          proposeResolution(market, select.value as Outcome);
                        }}
                        style={dangerButtonStyle}
                      >
                        Propose Resolution
                      </button>
                    </div>
                  </MarketRow>
                ))
              )}
            </Section>

            {/* Section 2: Oracle-proposed markets (PendingResolution) - dispute or finalize */}
            {oracleProposedMarkets.length > 0 && (
              <Section title={`Oracle Proposals (${oracleProposedMarkets.length})`} subtitle="Markets where the oracle proposed a result. Dispute within the window or finalize after it expires.">
                {oracleProposedMarkets.map(market => (
                  <MarketRow key={market.pubkey} market={market} ready>
                    <div style={{ marginTop: 8 }}>
                      <span className="success" style={{ fontWeight: 700, fontSize: 13 }}>
                        Oracle proposed: {market.proposedResult}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => disputeMarket(market)} style={dangerButtonStyle}>
                        Dispute
                      </button>
                      <button onClick={() => finalizeMarket(market)} style={secondaryButtonStyle}>
                        Finalize
                      </button>
                    </div>
                  </MarketRow>
                ))}
              </Section>
            )}

            {/* Section 3: Open governance proposals - approve or dispute */}
            {openProposals.length > 0 && (
              <Section title={`Open Proposals (${openProposals.length})`} subtitle="Governance proposals awaiting approval from the second admin signer.">
                {openProposals.map(proposal => {
                  const linkedMarket = markets.find(m => m.pubkey === proposal.actionMarket);
                  return (
                    <div key={proposal.pubkey} className="card" style={{ padding: 18, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <strong>{linkedMarket ? linkedMarket.title : 'Unknown market'}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {proposal.approvalCount} approval{proposal.approvalCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
                        Proposed: <strong>{proposal.actionResult}</strong> by {proposal.proposer.slice(0, 8)}...
                        <br />Proposal: {proposal.pubkey}
                      </p>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button onClick={() => approveProposalAction(proposal)} style={secondaryButtonStyle}>
                          Approve
                        </button>
                      </div>
                    </div>
                  );
                })}
              </Section>
            )}

            {/* Section 4: Approved proposals ready for execution */}
            {(() => {
              const approvedProposals = openProposals.filter(p => p.thresholdReachedTs > 0);
              if (approvedProposals.length === 0) return null;
              return (
                <Section title={`Ready to Execute (${approvedProposals.length})`} subtitle="Proposals that have reached the multisig threshold. Execute to move funds.">
                  {approvedProposals.map(proposal => {
                    const linkedMarket = markets.find(m => m.pubkey === proposal.actionMarket);
                    return (
                      <div key={proposal.pubkey} className="card" style={{ padding: 18, marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <strong>{linkedMarket ? linkedMarket.title : 'Unknown market'}</strong>
                          <span className="success">Threshold reached</span>
                        </div>
                        <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
                          Result: <strong>{proposal.actionResult}</strong>
                          <br />Proposal: {proposal.pubkey}
                        </p>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button onClick={() => executeProposal(proposal)} style={dangerButtonStyle}>
                            Execute
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </Section>
              );
            })()}
          </div>
        )}
      </section>
    </main>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
      <p className="muted" style={{ margin: '4px 0 12px', fontSize: 13 }}>{subtitle}</p>
      {children}
    </div>
  );
}

function MarketRow({ market, ready, children }: { market: Market; ready: boolean; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 18, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <strong>{market.title}</strong>
        <span className={ready ? 'success' : 'muted'}>{ready ? 'Ready' : 'Waiting oracle timeout'}</span>
      </div>
      <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
        Market #{market.id} — {market.pubkey}
      </p>
      <div className="card" style={{ padding: 12, background: '#18181b', marginTop: 12 }}>
        <Metric label="Pool" value={`${lamportsToSol(market.poolTotal)} SOL`} />
        <Metric label="YES" value={`${lamportsToSol(market.yesTotal)} SOL`} />
        <Metric label="NO" value={`${lamportsToSol(market.noTotal)} SOL`} />
      </div>
      {!ready && (
        <p className="danger" style={{ margin: '10px 0 0', fontSize: 13 }}>
          Oracle timeout has not passed. Actions will be rejected by the server.
        </p>
      )}
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid #3f3f46',
  background: '#18181b',
  color: '#fff',
  borderRadius: 6,
  padding: '11px 12px',
};

const secondaryButtonStyle: CSSProperties = {
  border: '1px solid #3f3f46',
  borderRadius: 6,
  padding: '10px 12px',
  background: '#18181b',
  color: '#fff',
};

const dangerButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 6,
  padding: '12px 16px',
  background: '#ef4444',
  color: '#fff',
  fontWeight: 800,
};