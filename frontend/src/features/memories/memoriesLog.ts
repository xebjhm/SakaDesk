import { clientLog } from '../../utils/clientLog';

export type MemoriesPage = 'home' | 'recap';

/** `memories_open`: the Memories feature was shown. Pass only the service id. */
export function logMemoriesOpen(service: string): void {
    clientLog('memories_open', { service });
}

/** `memories_page`: the Memories router moved to a page. Never pass names, text or paths. */
export function logMemoriesPage(page: MemoriesPage): void {
    clientLog('memories_page', { target: page });
}
