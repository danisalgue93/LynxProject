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
import i18n from './i18n';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import { SolanaProvider } from './providers/SolanaProvider';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import App from './App.tsx';
import './index.css';

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
