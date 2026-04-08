import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
    state = { hasError: false, error: null };

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary]', error, errorInfo);
    }

    handleReload = () => window.location.reload();

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center p-4">
                    <div className="pointer-events-none fixed inset-0 bg-mesh z-0" />
                    <div className="relative z-10 glass-strong rounded-3xl p-8 max-w-md text-center shadow-2xl">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 border border-danger/20 mb-5">
                            <AlertTriangle size={28} className="text-danger" />
                        </div>
                        <h1 className="text-xl font-bold text-text-primary tracking-tight">Something went wrong</h1>
                        <p className="mt-3 text-sm text-text-secondary leading-6">
                            The application encountered an unexpected error. Reloading usually fixes this.
                        </p>
                        {this.state.error?.message && (
                            <pre className="mt-4 glass-card rounded-xl px-4 py-3 text-left text-xs text-danger/80 font-mono overflow-x-auto max-h-32">
                                {this.state.error.message}
                            </pre>
                        )}
                        <button
                            onClick={this.handleReload}
                            className="mt-6 btn-primary rounded-xl px-6 py-3 text-sm font-semibold inline-flex items-center gap-2"
                        >
                            <RefreshCw size={14} /> Reload Application
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
