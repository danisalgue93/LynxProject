import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { Sentry } from '../../lib/sentry';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  eventId: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, eventId: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, eventId: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Report to Sentry (no-op if DSN is not configured)
    const eventId = Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
    this.setState({ eventId: eventId ?? null });
    // Always log locally too
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, eventId: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-[#0D0D0E] border border-[#27272A] rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-3">Something went wrong</h2>
          <p className="text-sm text-[#71717A] mb-2">
            An unexpected error occurred. Please try refreshing the page.
          </p>
          {this.state.eventId && (
            <p className="text-xs text-[#52525B] font-mono mt-1">
              Error ID: {this.state.eventId}
            </p>
          )}
          {import.meta.env.DEV && this.state.error && (
            <pre className="text-left text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded p-3 mt-4 overflow-auto max-h-32">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-3 justify-center mt-6">
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 px-4 py-2 bg-[#18181B] border border-[#27272A] text-white text-sm rounded hover:border-[#00FFD1]/50 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-[#00FFD1] text-black text-sm font-bold rounded hover:bg-[#00E5BC] transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
