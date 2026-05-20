'use client';

import { FormEvent, useState } from 'react';
import type { CSSProperties } from 'react';

export default function LoginPage() {
  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [loading, setLoading] = useState(false);

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Login failed');
      if (data.devOtp) setDevOtp(data.devOtp);
      setStep('otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'OTP failed');
      window.location.href = '/admin';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="panel" style={{ maxWidth: 420, paddingTop: 80 }}>
        <div className="card" style={{ padding: 28 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Lynx Emergency Admin</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Manual resolution is locked behind password, Telegram OTP and on-chain timeout checks.
          </p>

          {step === 'password' ? (
            <form onSubmit={requestOtp} style={{ display: 'grid', gap: 14, marginTop: 24 }}>
              <label>
                <span className="muted" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
                  Admin password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  style={inputStyle}
                />
              </label>
              {error && <p className="danger">{error}</p>}
              <button disabled={loading} style={primaryButtonStyle}>
                {loading ? 'Checking...' : 'Send Telegram OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} style={{ display: 'grid', gap: 14, marginTop: 24 }}>
              <div className="card" style={{ padding: 14, background: '#172554' }}>
                <p style={{ margin: 0, color: '#bfdbfe', fontSize: 13 }}>
                  A 6-digit code was sent to your Telegram. It expires in 5 minutes.
                </p>
                {devOtp && (
                  <p style={{ margin: '10px 0 0', color: '#fff', fontSize: 18, fontWeight: 800 }}>
                    Local dev OTP: {devOtp}
                  </p>
                )}
              </div>
              <label>
                <span className="muted" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
                  Telegram OTP
                </span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                  required
                  style={{ ...inputStyle, textAlign: 'center', letterSpacing: 8, fontSize: 24 }}
                />
              </label>
              {error && <p className="danger">{error}</p>}
              <button disabled={loading || otp.length !== 6} style={primaryButtonStyle}>
                {loading ? 'Verifying...' : 'Enter admin panel'}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid #3f3f46',
  background: '#18181b',
  color: '#fff',
  borderRadius: 6,
  padding: '12px 14px',
};

const primaryButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 6,
  padding: '12px 16px',
  background: '#00ffd1',
  color: '#000',
  fontWeight: 800,
};
