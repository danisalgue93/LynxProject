/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './context/AuthContext';
import { ToastContainer } from './components/layout/ToastContainer';

// Route-level code splitting — Dashboard is ~300KB; lazy-loading it avoids
// including it in the initial bundle that the public page needs.
const Dashboard = lazy(() =>
  import('./pages/Dashboard').then(m => ({ default: m.Dashboard }))
);
const PublicPage = lazy(() =>
  import('./pages/PublicPage').then(m => ({ default: m.PublicPage }))
);

function PageLoader() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-400" />
        <p className="mt-4 text-slate-400">{t('common.loading', 'Loading...')}</p>
      </div>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, isLoading, verifyEmail } = useAuth();
  const location = useLocation();

  // Handle deep-link tokens from email verification / password reset emails.
  // e.g. https://lynxmarket.io/?verify=TOKEN or /?reset=TOKEN
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const verifyToken = params.get('verify');
    const resetToken = params.get('reset');

    if (verifyToken) {
      // Auto-verify and open auth modal on success
      verifyEmail(verifyToken)
        .then(() => {
          // Clean URL and trigger redirect to dashboard via re-render
          window.history.replaceState({}, '', '/');
          window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
        })
        .catch(() => {
          window.history.replaceState({}, '', '/');
          window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
        });
    } else if (resetToken) {
      // Pre-fill the reset token and open auth modal in reset mode
      window.history.replaceState({}, '', '/');
      window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'reset', token: resetToken } }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return <PageLoader />;
  }

  return (
    <>
      <ToastContainer />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public route — accessible to everyone */}
          <Route path="/" element={<PublicPage />} />

          {/* Login is handled only through AuthModal */}
          <Route path="/login" element={<Navigate to="/" />} />

          {/* Protected dashboard — only for authenticated users */}
          <Route
            path="/dashboard"
            element={isAuthenticated ? <Dashboard /> : <Navigate to="/" />}
          />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
    </>
  );
}
