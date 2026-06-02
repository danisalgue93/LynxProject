/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Dashboard } from './pages/Dashboard';
import { PublicPage } from './pages/PublicPage';
import { ToastContainer } from './components/layout/ToastContainer';

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-400"></div>
          <p className="mt-4 text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ToastContainer />
      <Routes>
      {/* Public route - accessible to everyone */}
      <Route path="/" element={<PublicPage />} />
      
      {/* Login is handled only through AuthModal. */}
      <Route path="/login" element={<Navigate to="/" />} />
      
      {/* Protected dashboard - only for authenticated users */}
      <Route path="/dashboard" element={isAuthenticated ? <Dashboard /> : <Navigate to="/" />} />
      
      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
    </>
  );
}
