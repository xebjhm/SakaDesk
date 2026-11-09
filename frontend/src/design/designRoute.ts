/**
 * True when the page was opened as the dev-only style page (`?view=design`).
 * main.tsx only calls this behind `import.meta.env.DEV`, so production
 * builds never include the page.
 */
export function isDesignView(search: string): boolean {
    return new URLSearchParams(search).get('view') === 'design';
}
