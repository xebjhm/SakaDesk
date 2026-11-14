import { Component, type ReactNode } from 'react';
import { StatusBlock } from '../../design/primitives';
import { clientLog } from '../../utils/clientLog';

/** The lazy Memories import failed (a missing or unreadable chunk), as opposed to a render crash. */
export class MemoriesChunkError extends Error {
    /** The import's rejection (kept as a field: `lib` is ES2020, without `ErrorOptions`). */
    readonly reason: unknown;
    constructor(reason: unknown) {
        super('memories chunk failed to load');
        this.name = 'MemoriesChunkError';
        this.reason = reason;
    }
}

interface Props {
    children: ReactNode;
    title: string;
    retryLabel: string;
    /**
     * Re-creates the lazy component (React.lazy keeps a rejected import), before the children render again.
     * Chromium can keep a failed dynamic import in its module map, so when the chunk fails again after a
     * Retry, Retry reloads the page instead (same button, same label).
     */
    onRetry: () => void;
    /** Reloads the page; the default is `window.location.reload()` (injected so tests can observe it). */
    onReload?: () => void;
}

/**
 * Between the Memories Suspense and the root: a chunk that fails to load shows an error with Retry
 * inside the pane, instead of the app-wide crash screen. Any other error is thrown on to the root
 * `ErrorBoundary`, so a render crash inside Memories behaves as before. The failure itself is logged
 * once, where the import rejects (ContentArea); this boundary logs only what the user then does.
 */
export class MemoriesChunkBoundary extends Component<Props, { error: unknown; retried: boolean }> {
    state: { error: unknown; retried: boolean } = { error: null, retried: false };

    static getDerivedStateFromError(error: unknown) {
        return { error };
    }

    private retry = () => {
        if (this.state.retried) {
            // The re-created lazy failed again: the module map may hold the failed import until a reload.
            clientLog('app_load_failed', { target: 'memories_chunk', outcome: 'reload' });
            (this.props.onReload ?? (() => window.location.reload()))();
            return;
        }
        clientLog('app_load_failed', { target: 'memories_chunk', outcome: 'retry' });
        this.props.onRetry();
        this.setState({ error: null, retried: true });
    };

    render() {
        const { error } = this.state;
        if (error === null) return this.props.children;
        if (!(error instanceof MemoriesChunkError)) throw error;
        return (
            <StatusBlock kind="error" variant="pane" surface="memories_chunk" title={this.props.title}
                onRetry={this.retry} retryLabel={this.props.retryLabel} />
        );
    }
}
