import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * Global error boundary — catches render-time crashes anywhere in the app
 * and shows a recovery screen instead of a blank white page.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught UI error:', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-app text-primary flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-surface border border-edge rounded-2xl p-8 space-y-5 text-center shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-danger/10 border border-danger/30 text-danger flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-black text-primary">Something went wrong</h1>
            <p className="text-xs text-secondary leading-relaxed">
              The reader hit an unexpected error. Your library data is safe on the server — try reloading the app.
            </p>
          </div>
          <div className="px-4 py-3 rounded-xl bg-app border border-edge text-left">
            <code className="text-[11px] text-danger font-mono break-all">{this.state.message}</code>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs flex items-center gap-2 transition-all active:scale-95"
            >
              <RefreshCw className="w-4 h-4" />
              Reload App
            </button>
            <button
              onClick={() => {
                window.location.href = '/';
              }}
              className="px-5 py-2.5 rounded-xl bg-elevated hover:bg-elevated text-primary font-bold text-xs flex items-center gap-2 transition-all active:scale-95"
            >
              <Home className="w-4 h-4" />
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}