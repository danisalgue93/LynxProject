import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import './i18n';
import { initializeLanguage } from './i18n';
import { SolanaProvider } from './providers/SolanaProvider.tsx';
import { AuthProvider } from './context/AuthContext';

// Initialize location based language
initializeLanguage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SolanaProvider>
          <App />
        </SolanaProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
