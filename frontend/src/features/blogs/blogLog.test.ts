import { describe, it, expect, vi } from 'vitest';
import { clientLog } from '../../utils/clientLog';
import { logBlogLoad } from './blogLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

describe('logBlogLoad', () => {
    it('sends the target and outcome, and the count when given', () => {
        logBlogLoad('recent', 'ok', 9);
        expect(clientLog).toHaveBeenLastCalledWith('blog_load', { target: 'recent', outcome: 'ok', count: 9 });
        logBlogLoad('content', 'cache_hit');
        expect(clientLog).toHaveBeenLastCalledWith('blog_load', { target: 'content', outcome: 'cache_hit' });
        logBlogLoad('content', 'in_flight');
        expect(clientLog).toHaveBeenLastCalledWith('blog_load', { target: 'content', outcome: 'in_flight' });
    });
});
