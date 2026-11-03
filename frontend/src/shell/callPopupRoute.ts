/** True when the page was opened as the bottom-right call popup (`?view=call-popup`). */
export function isCallPopupView(search: string): boolean {
    return new URLSearchParams(search).get('view') === 'call-popup';
}
