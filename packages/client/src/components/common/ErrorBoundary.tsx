import React, { Component, ErrorInfo, ReactNode } from 'react';
import './ErrorBoundary.css';

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
        this.setState({
            error,
            errorInfo
        });
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="error-boundary-overlay">
                    <div className="error-boundary-dialog">
                        <h2>Something went wrong</h2>
                        <div className="error-message">
                            {this.state.error && this.state.error.toString()}
                        </div>
                        {this.state.errorInfo && (
                            <details style={{ whiteSpace: 'pre-wrap', marginTop: '10px' }}>
                                <summary>Component Stack Trace</summary>
                                {this.state.errorInfo.componentStack}
                            </details>
                        )}
                        <button
                            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                            style={{ marginTop: '20px', padding: '8px 16px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
