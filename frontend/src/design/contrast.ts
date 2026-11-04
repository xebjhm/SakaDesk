/** WCAG 2.x contrast ratio, used by the style page to label swatches. */
export function parseHex(value: string): [number, number, number] | null {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (!match) return null;
    const hex = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function channel(value: number): number {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: [number, number, number]): number {
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number | null {
    const pa = parseHex(a);
    const pb = parseHex(b);
    if (!pa || !pb) return null;
    const la = luminance(pa);
    const lb = luminance(pb);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
