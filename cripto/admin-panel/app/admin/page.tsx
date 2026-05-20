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
};

type Outcome = 'Yes' | 'No' | 'Draw';

export default function AdminPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Market | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('Yes');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [signature, setSignature] = useState('');

  async function loadMarkets() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/markets/pending');
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load markets');
      setMarkets(data.markets);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMarkets();
  }, []);

  const selectedReady = useMemo(() => {
    if (!selected) return false;
    return Math.floor(Date.now() / 1000) >= selected.oracleDeadline;
  }, [selected]);

  async function resolveSelected() {
    if (!selected) return;
    setPending(true);
    setError('');
    setSignature('');
    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketPubkey: selected.pubkey,
          result: outcome,
          confirmation,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Resolution failed');
      setSignature(data.signature);
      setSelected(null);
      setConfirmation('');
      await loadMarkets();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <main className="shell">
      <section className="panel">
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Emergency Resolution</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              Only markets in CutOff state are shown. The server refuses to sign before oracle_deadline.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={loadMarkets} style={secondaryButtonStyle}>Refresh</button>
            <button onClick={logout} style={secondaryButtonStyle}>Logout</button>
          </div>
        </header>

        {signature && (
          <div className="card" style={{ padding: 16, marginTop: 22, borderColor: '#059669' }}>
            <strong className="success">Resolution sent.</strong>
            <p style={{ marginBottom: 0, wordBreak: 'break-all' }}>{signature}</p>
          </div>
        )}

        {error && (
          <div className="card" style={{ padding: 16, marginTop: 22, borderColor: '#dc2626' }}>
            <strong className="danger">{error}</strong>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 22, marginTop: 24 }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            {loading ? (
              <p className="muted" style={{ padding: 20 }}>Loading markets...</p>
            ) : markets.length === 0 ? (
              <p className="muted" style={{ padding: 20 }}>No CutOff markets pending manual resolution.</p>
            ) : (
              markets.map((market) => {
                const ready = Math.floor(Date.now() / 1000) >= market.oracleDeadline;
                return (
                  <button
                    key={market.pubkey}
                    onClick={() => {
                      setSelected(market);
                      setConfirmation('');
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: 18,
                      border: 0,
                      borderBottom: '1px solid #27272a',
                      background: selected?.pubkey === market.pubkey ? '#18181b' : '#111113',
                      color: '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <strong>{market.title}</strong>
                      <span className={ready ? 'success' : 'muted'}>{ready ? 'Ready' : 'Waiting oracle timeout'}</span>
                    </div>
                    <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
                      Market #{market.id} - {market.pubkey}
                    </p>
                  </button>
                );
              })
            )}
          </div>

          <aside className="card" style={{ padding: 18, alignSelf: 'start' }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Manual action</h2>
            {!selected ? (
              <p className="muted">Select a market to resolve.</p>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                <div>
                  <strong>{selected.title}</strong>
                  <p className="muted" style={{ marginBottom: 0, fontSize: 13, wordBreak: 'break-all' }}>
                    Oracle authority: {selected.oracleAuthority}
                  </p>
                </div>

                <div className="card" style={{ padding: 12, background: '#18181b' }}>
                  <Metric label="Pool" value={`${lamportsToSol(selected.poolTotal)} SOL`} />
                  <Metric label="YES" value={`${lamportsToSol(selected.yesTotal)} SOL`} />
                  <Metric label="NO" value={`${lamportsToSol(selected.noTotal)} SOL`} />
                </div>

                <label>
                  <span className="muted" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Result</span>
                  <select value={outcome} onChange={(event) => setOutcome(event.target.value as Outcome)} style={inputStyle}>
                    <option value="Yes">YES</option>
                    <option value="No">NO</option>
                    <option value="Draw">DRAW</option>
                  </select>
                </label>

                <label>
                  <span className="muted" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
                    Type RESOLVE {outcome}
                  </span>
                  <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} style={inputStyle} />
                </label>

                {!selectedReady && (
                  <p className="danger" style={{ margin: 0, fontSize: 13 }}>
                    Oracle timeout has not passed. The server will reject this action.
                  </p>
                )}

                <button
                  onClick={resolveSelected}
                  disabled={pending || confirmation !== `RESOLVE ${outcome}`}
                  style={dangerButtonStyle}
                >
                  {pending ? 'Signing...' : `Resolve as ${outcome}`}
                </button>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
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

function lamportsToSol(value: string) {
  return (Number(value) / 1_000_000_000).toFixed(4);
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
