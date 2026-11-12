const MARKS_ONLY = /^\p{M}+$/u;

interface Segment {
    rawStart: number;
    rawEnd: number;
    normStart: number;
    normEnd: number;
}

/**
 * The raw `[start, end)` spans of `text` whose NFKC form contains `keyword` (already NFKC), in
 * order and non-overlapping. The backend picks the shared keyword on NFKC text
 * (`selection.normalize`), so her half-width ｸﾘｽﾏｽ or full-width ＸＭＡＳ must match too. The text is
 * cut into segments (a code point plus any following code points that normalize to combining
 * marks, so ﾊ + ﾞ stay one segment and compose to バ); a match marks every segment it touches.
 */
export function nfkcMatches(text: string, keyword: string): Array<[number, number]> {
    if (!keyword) return [];
    const segments: Segment[] = [];
    let norm = '';
    let raw = 0;
    let pending: { start: number; text: string } | null = null;
    const flush = () => {
        if (!pending) return;
        const n = pending.text.normalize('NFKC');
        segments.push({ rawStart: pending.start, rawEnd: pending.start + pending.text.length, normStart: norm.length, normEnd: norm.length + n.length });
        norm += n;
        pending = null;
    };
    for (const cp of text) {
        if (pending && MARKS_ONLY.test(cp.normalize('NFKC'))) {
            pending.text += cp;
        } else {
            flush();
            pending = { start: raw, text: cp };
        }
        raw += cp.length;
    }
    flush();
    const spans: Array<[number, number]> = [];
    let from = 0;
    for (let at = norm.indexOf(keyword); at >= 0; at = norm.indexOf(keyword, from)) {
        const last = at + keyword.length - 1;
        const first = segments.find((g) => g.normStart <= at && at < g.normEnd);
        const end = segments.find((g) => g.normStart <= last && last < g.normEnd);
        if (!first || !end) break;
        spans.push([first.rawStart, end.rawEnd]);
        from = end.normEnd;
    }
    return spans;
}
