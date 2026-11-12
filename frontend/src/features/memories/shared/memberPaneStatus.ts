import type { MemoriesQuery } from './useMemoriesQuery';

/** The `MemberPane` member list's load state. */
export type MemberPaneStatus = 'loading' | 'ready' | 'error' | 'timeout';

/** The pane's state from its members query (`useMemoriesQuery`): a timeout keeps its own state. */
export function memberPaneStatus(query: Pick<MemoriesQuery<unknown>, 'status' | 'failure'>): MemberPaneStatus {
    if (query.status === 'error') return query.failure === 'timeout' ? 'timeout' : 'error';
    return query.status;
}
