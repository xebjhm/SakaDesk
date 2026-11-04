/** Dev-only GroupedVirtuoso probe page (`?view=timeline-probe`), used by e2e/probe. main.tsx gates it behind `import.meta.env.DEV`. */
export function isTimelineProbeView(search: string): boolean {
    return new URLSearchParams(search).get('view') === 'timeline-probe';
}
