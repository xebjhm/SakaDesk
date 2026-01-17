import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Bug } from 'lucide-react';

interface Props {
    children: ReactNode;
    onReportIssue?: (error: string) => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ errorInfo });
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    handleReport = () => {
        const { error, errorInfo } = this.state;
        const errorMessage = error
            ? `${error.name}: ${error.message}${errorInfo?.componentStack ? `\n\nComponent Stack:${errorInfo.componentStack.slice(0, 500)}` : ''}`
            : 'Unknown error';
        this.props.onReportIssue?.(errorMessage);
    };

    render() {
        if (this.state.hasError) {
            const { error, errorInfo } = this.state;

            return (
                <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
                        {/* Header */}
                        <div className="bg-red-500 px-6 py-4">
                            <div className="flex items-center gap-3">
                                <AlertTriangle className="w-6 h-6 text-white" />
                                <h1 className="text-xl font-bold text-white">Something went wrong</h1>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-4">
                            <p className="text-gray-600">
                                The app encountered an unexpected error. Your data is safe - this is just a display issue.
                            </p>

                            {/* Error Details */}
                            {error && (
                                <div className="bg-gray-50 rounded-lg p-4 font-mono text-xs text-gray-700 overflow-auto max-h-32">
                                    <p className="font-semibold text-red-600">{error.name}: {error.message}</p>
                                    {errorInfo?.componentStack && (
                                        <p className="mt-2 text-gray-500 whitespace-pre-wrap">
                                            {errorInfo.componentStack.split('\n').slice(0, 5).join('\n')}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={this.handleRetry}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Try Again
                                </button>
                                <button
                                    onClick={this.handleReport}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/20"
                                >
                                    <Bug className="w-4 h-4" />
                                    Report Issue
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
