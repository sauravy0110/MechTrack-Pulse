import { Component } from 'react';

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        console.error('[ErrorBoundary]', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="h-screen flex items-center justify-center bg-bg-primary">
                    <div className="text-center max-w-sm p-8">
                        <div className="w-14 h-14 bg-danger/10 border border-danger/30 rounded-full flex items-center justify-center mx-auto mb-6">
                            <svg className="w-7 h-7 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                        </div>
                        <h2 className="text-base font-bold text-text-primary mb-2">System Error</h2>
                        <p className="text-text-muted text-sm mb-6">A rendering error occurred. This has been logged.</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-2.5 bg-accent hover:bg-accent-glow text-white text-sm font-bold rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer"
                        >
                            Reload System
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
