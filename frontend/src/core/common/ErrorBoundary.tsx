import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Bug } from 'lucide-react';
import i18n from '../../i18n';
import { Button } from '../../design/primitives';
import { brandScopeStyle } from '../../design/brandScope';
import { breadcrumbCode, clientLog } from '../../utils/clientLog';

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
        // The class name only (no message, no stack): a crash must be findable in debug.log.
        clientLog('app_load_failed', { target: 'render', error_type: breadcrumbCode(error) });
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
            // Translate through the i18n instance directly: this screen renders after a crash, so it
            // cannot rely on a provider. Every call carries its English text as `defaultValue`, so an
            // uninitialised or failed i18n shows English, not raw keys.
            const t = i18n.t.bind(i18n);

            return (
                <div style={brandScopeStyle()} className="flex h-screen items-safe-center justify-center overflow-y-auto bg-window p-4">
                    <div role="alert" className="w-full max-w-md overflow-hidden rounded-xl bg-sheet shadow-sheet">
                        {/* Plain header with the error-state tile (as StatusBlock kind="error"): the solid
                            danger step is only for destructive buttons (DESIGN_SYSTEM "Semantic colours"). */}
                        <div className="flex items-center gap-3 px-6 pt-6">
                            <span aria-hidden="true" className="flex shrink-0 rounded-card bg-semantic-danger-icon p-3 text-semantic-danger">
                                <AlertTriangle className="h-6 w-6" />
                            </span>
                            <h1 className="min-w-0 break-words text-heading font-bold text-primary">{t('errorBoundary.title', { defaultValue: 'Something went wrong' })}</h1>
                        </div>

                        <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
                            <p className="text-body text-secondary">{t('errorBoundary.body', { defaultValue: 'SakaDesk ran into an unexpected error. Your data is safe: only the screen failed to draw.' })}</p>

                            {error && (
                                <div className="max-h-32 overflow-auto rounded-lg bg-sunken p-4 font-mono text-caption text-secondary">
                                    <p className="break-words font-semibold text-status-danger">{error.name}: {error.message}</p>
                                    {errorInfo?.componentStack && (
                                        <p className="mt-2 whitespace-pre-wrap break-words text-muted">
                                            {errorInfo.componentStack.split('\n').slice(0, 5).join('\n')}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Wraps: a button keeps its whole label (Button is whitespace-nowrap), so on a
                                narrow card the two stack instead of one overflowing. */}
                            <div className="flex flex-wrap gap-3 pt-2">
                                <Button variant="secondary" className="min-w-fit flex-1" onClick={this.handleRetry}>
                                    <RefreshCw aria-hidden="true" className="h-4 w-4" />
                                    {t('errorBoundary.retry', { defaultValue: 'Try again' })}
                                </Button>
                                <Button variant="primary" className="min-w-fit flex-1" onClick={this.handleReport}>
                                    <Bug aria-hidden="true" className="h-4 w-4" />
                                    {t('errorBoundary.report', { defaultValue: 'Report issue' })}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
