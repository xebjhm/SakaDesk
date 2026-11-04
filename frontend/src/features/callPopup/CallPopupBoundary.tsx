import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
    /** Called once, from componentDidCatch, when a descendant throws while rendering. */
    onError: () => void;
}

/**
 * Catches a render crash inside one popup call. The popup has no UI worth showing for a
 * crash, so it renders nothing and tells the owner, who reports it to the backend.
 */
export class CallPopupBoundary extends Component<Props, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('CallPopupBoundary caught an error:', error, info);
        this.props.onError();
    }

    render() {
        return this.state.failed ? null : this.props.children;
    }
}
