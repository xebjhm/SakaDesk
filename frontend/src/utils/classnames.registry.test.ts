import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TW_MERGE_CLASS_GROUPS, cn } from './classnames';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

/** Keys of one `theme.extend` section of tailwind.config.js (`name:` or `'name':` at the section's indent + 4). */
function keysOf(section: string): string[] {
    const keys = parseKeys(section);
    // describe.each over an empty list silently runs zero cases: fail loudly if the parser finds nothing.
    expect(keys.length, `keys parsed from the ${section} section`).toBeGreaterThan(0);
    return keys;
}

function parseKeys(section: string): string[] {
    const start = config.indexOf(`            ${section}: {`);
    expect(start, `${section} section in tailwind.config.js`).toBeGreaterThan(-1);
    const lineEnd = config.indexOf('\n', start);
    if (config.slice(start, lineEnd).trimEnd().endsWith('},')) {
        // One-line section: `name: { 94: '.94', 106: '1.06' },`
        return [...config.slice(start, lineEnd).matchAll(/[{,]\s*'?([a-z0-9-]+)'?:/g)].map((m) => m[1]);
    }
    const end = config.indexOf('\n            },', start);
    return [...config.slice(start, end).matchAll(/^ {16}'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]);
}

type GroupId = keyof typeof TW_MERGE_CLASS_GROUPS;

const registered = (group: GroupId, prefix: string): string[] =>
    (TW_MERGE_CLASS_GROUPS[group] as unknown as Record<string, string[]>[])[0][prefix];

describe('tailwind-merge registry (UI health H-T8)', () => {
    it.each([
        ['animation', 'animate', 'animate'],
        ['boxShadow', 'shadow', 'shadow'],
        ['transitionDuration', 'duration', 'duration'],
        ['transitionTimingFunction', 'ease', 'ease'],
        ['fontSize', 'font-size', 'text'],
        ['textColor', 'text-color', 'text'],
        ['backgroundColor', 'bg-color', 'bg'],
        ['backgroundImage', 'bg-image', 'bg'],
        ['borderColor', 'border-color', 'border'],
        ['ringColor', 'ring-color', 'ring'],
        ['fill', 'fill', 'fill'],
        ['fontFamily', 'font-family', 'font'],
        ['sepia', 'sepia', 'sepia'],
        ['maxHeight', 'max-h', 'max-h'],
        ['blur', 'blur', 'blur'],
        ['backdropBlur', 'backdrop-blur', 'backdrop-blur'],
    ] as const)('registers every %s key', (section, group, prefix) => {
        const keys = keysOf(section);
        expect(keys.length).toBeGreaterThan(0);
        expect(keys.filter((k) => !registered(group, prefix).includes(k))).toEqual([]);
    });

    it('registers every token radius (the built-in sizes merge on their own)', () => {
        const own = new Set(['none', 'xs', 'sm', 'md', 'lg', 'xl', 'full']);
        const keys = keysOf('borderRadius').filter((k) => !own.has(k));
        expect(keys.filter((k) => !registered('rounded', 'rounded').includes(k))).toEqual([]);
    });

    it('keeps one token of a group from coexisting with another (decision 10a)', () => {
        expect(cn('shadow-card', 'shadow-memories-polaroid')).toBe('shadow-memories-polaroid');
        expect(cn('animate-reveal', 'animate-star-fall')).toBe('animate-star-fall');
    });
});

describe('token text sizes and colours never collide', () => {
    const sizes = keysOf('fontSize');
    const colours = keysOf('textColor');

    it.each(sizes)('text-%s keeps every token text colour', (size) => {
        for (const colour of colours) {
            expect(cn(`text-${size}`, `text-${colour}`)).toBe(`text-${size} text-${colour}`);
            expect(cn(`text-${colour}`, `text-${size}`)).toBe(`text-${colour} text-${size}`);
        }
    });

    it.each(sizes)('text-%s replaces a built-in size and is replaced by one', (size) => {
        expect(cn('text-sm', `text-${size}`)).toBe(`text-${size}`);
        expect(cn(`text-${size}`, 'text-sm')).toBe('text-sm');
    });

    it.each(colours)('text-%s replaces a built-in colour and is replaced by one', (colour) => {
        expect(cn('text-red-500', `text-${colour}`)).toBe(`text-${colour}`);
        expect(cn(`text-${colour}`, 'text-red-500')).toBe('text-red-500');
    });

    it('two token sizes or two token colours still resolve to the last', () => {
        expect(cn('text-caption', 'text-title')).toBe('text-title');
        expect(cn('text-primary', 'text-muted')).toBe('text-muted');
    });
});

describe('token background, border and ring utilities', () => {
    it.each(keysOf('backgroundColor'))('bg-%s is a colour: merges with colours, keeps gradients', (k) => {
        expect(cn('bg-red-500', `bg-${k}`)).toBe(`bg-${k}`);
        expect(cn(`bg-${k}`, 'bg-red-500')).toBe('bg-red-500');
        expect(cn(`bg-${k}`, 'bg-accent-gradient')).toBe(`bg-${k} bg-accent-gradient`);
    });

    it.each(keysOf('backgroundImage'))('bg-%s is an image: keeps colours, merges with images', (k) => {
        expect(cn(`bg-${k}`, 'bg-sheet')).toBe(`bg-${k} bg-sheet`);
        expect(cn('bg-sheet', `bg-${k}`)).toBe(`bg-sheet bg-${k}`);
        expect(cn('bg-gradient-to-r', `bg-${k}`)).toBe(`bg-${k}`);
    });

    it.each(keysOf('borderColor'))('border-%s is a colour: keeps widths, merges with colours', (k) => {
        expect(cn(`border-${k}`, 'border-2')).toBe(`border-${k} border-2`);
        expect(cn('border-red-500', `border-${k}`)).toBe(`border-${k}`);
        expect(cn(`border-${k}`, 'border-red-500')).toBe('border-red-500');
    });

    it.each(keysOf('ringColor'))('ring-%s is a colour: keeps widths, merges with colours', (k) => {
        expect(cn(`ring-${k}`, 'ring-2')).toBe(`ring-${k} ring-2`);
        expect(cn('ring-red-500', `ring-${k}`)).toBe(`ring-${k}`);
    });

    it.each(keysOf('borderRadius'))('rounded-%s merges with built-in radii', (k) => {
        expect(cn('rounded-3xl', `rounded-${k}`)).toBe(`rounded-${k}`);
        expect(cn(`rounded-${k}`, 'rounded-3xl')).toBe('rounded-3xl');
    });
});

describe('other token utilities', () => {
    it.each(keysOf('boxShadow'))('shadow-%s merges with built-in shadows, keeps rings', (k) => {
        expect(cn('shadow-lg', `shadow-${k}`)).toBe(`shadow-${k}`);
        expect(cn(`shadow-${k}`, 'shadow-lg')).toBe('shadow-lg');
        expect(cn(`shadow-${k}`, 'ring-2')).toBe(`shadow-${k} ring-2`);
        expect(cn(`shadow-${k}`, 'shadow-red-500')).toBe(`shadow-${k} shadow-red-500`);
    });

    it.each(keysOf('animation'))('animate-%s merges with built-in animations', (k) => {
        expect(cn('animate-spin', `animate-${k}`)).toBe(`animate-${k}`);
        expect(cn(`animate-${k}`, 'animate-spin')).toBe('animate-spin');
        expect(cn(`animate-${k}`, 'duration-base')).toBe(`animate-${k} duration-base`);
    });

    it.each(keysOf('transitionDuration'))('duration-%s merges with numeric durations', (k) => {
        expect(cn('duration-300', `duration-${k}`)).toBe(`duration-${k}`);
        expect(cn(`duration-${k}`, 'duration-300')).toBe('duration-300');
    });

    it.each(keysOf('transitionTimingFunction'))('ease-%s merges with built-in easings', (k) => {
        expect(cn('ease-in', `ease-${k}`)).toBe(`ease-${k}`);
        expect(cn(`ease-${k}`, 'ease-in')).toBe('ease-in');
    });

    it.each(keysOf('fontFamily'))('font-%s keeps weights and replaces other families', (k) => {
        expect(cn(`font-${k}`, 'font-bold')).toBe(`font-${k} font-bold`);
        expect(cn('font-mono', `font-${k}`)).toBe(`font-${k}`);
    });

    it.each(keysOf('sepia'))('sepia-%s merges with built-in sepia', (k) => {
        expect(cn('sepia-0', `sepia-${k}`)).toBe(`sepia-${k}`);
        expect(cn(`sepia-${k}`, 'sepia-0')).toBe('sepia-0');
    });

    it('max-h-small-3 merges with built-in max heights', () => {
        expect(cn('max-h-full', 'max-h-small-3')).toBe('max-h-small-3');
        expect(cn('max-h-small-3', 'max-h-full')).toBe('max-h-full');
    });

    it('scale-97, brightness and blur tokens merge with their built-ins', () => {
        expect(cn('scale-50', 'scale-97')).toBe('scale-97');
        expect(cn('brightness-50', 'brightness-94')).toBe('brightness-94');
        expect(cn('blur-sm', 'blur-placeholder')).toBe('blur-placeholder');
        expect(cn('backdrop-blur-sm', 'backdrop-blur-frost')).toBe('backdrop-blur-frost');
        expect(cn('backdrop-saturate-50', 'backdrop-saturate-180')).toBe('backdrop-saturate-180');
    });
});

describe('merges that are not design-system groups', () => {
    it('keeps built-in merges working (extend, not override)', () => {
        expect(cn('justify-center', 'justify-between')).toBe('justify-between');
        expect(cn('items-center', 'items-start')).toBe('items-start');
        expect(cn('p-2', 'p-4')).toBe('p-4');
        expect(cn('text-sm', 'text-lg')).toBe('text-lg');
    });

    it('registers the safe-center alignments', () => {
        expect(cn('justify-center', 'justify-safe-center')).toBe('justify-safe-center');
        expect(cn('items-start', 'items-safe-center')).toBe('items-safe-center');
        expect(cn('justify-safe-center', 'justify-between')).toBe('justify-between');
    });

    it('registers the mask-fade-y and transition-caption utilities', () => {
        expect(cn('mask-fade-y', 'mask-fade-y')).toBe('mask-fade-y');
        expect(cn('transition-all', 'transition-caption')).toBe('transition-caption');
    });

    it('phrase-break is deliberately unregistered: it coexists with break-words / break-all', () => {
        expect(cn('break-words', 'phrase-break')).toBe('break-words phrase-break');
        expect(cn('phrase-break', 'break-all')).toBe('phrase-break break-all');
    });
});
