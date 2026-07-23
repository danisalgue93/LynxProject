/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IMPORTANT: sentry.ts MUST be the very first import so that it can
 * instrument React, the router, and all other libraries before they load.
 */
import './lib/sentry';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n, { initializeLanguage } from './i18n';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import { SolanaProvider } from './providers/SolanaProvider';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import App from './App.tsx';
import './index.css';

// Pick the initial language from the user's saved choice, else the browser
// locale, BEFORE first render (audit frontend-6.2). Without this call the
// exported detector was dead code and every first-time visitor got English
// regardless of their browser language. Fire-and-forget: it only calls the
// synchronous i18n.changeLanguage under the hood.
void initializeLanguage();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <AuthProvider>
            <SolanaProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </SolanaProvider>
          </AuthProvider>
        </ToastProvider>
      </I18nextProvider>
    </BrowserRouter>
  </React.StrictMode>
);
