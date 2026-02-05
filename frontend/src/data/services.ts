// frontend/src/data/services.ts
// Single source of truth for service definitions
// Colors are derived from the brand palette for consistency

// Note: Colors are defined statically for Tailwind JIT compatibility.
// Canonical color values live in config/colors/palette.ts - keep in sync.

export interface ServiceDefinition {
    id: string;
    name: string;
    displayName: string;
    shortCode: string;
    color: string;          // Gradient classes for UI elements
    bgColor: string;        // Solid bg class for icons/badges
    blogBaseUrl: string;    // Base URL for blog content normalization
    description: string;
    logoUrl: string;        // Official logo URL (hotlinked from official site)
}

// Tailwind requires static class names at build time.
// These colors are derived from BRAND_COLORS in palette.ts - keep them in sync.
// hinatazaka: primary=#7cc7e8, primaryDark=#5eb3d8
// sakurazaka: primary=#E85298, primaryLight=#f7a6c9
// nogizaka: primary=#7e1083, primaryDark=#5a0b5e

export const SERVICES: ServiceDefinition[] = [
    {
        id: 'hinatazaka46',
        name: 'Hinatazaka46',
        displayName: '日向坂46',
        shortCode: 'HI',
        color: 'from-[#7cc7e8] to-[#5eb3d8]',
        bgColor: 'bg-[#7cc7e8]',
        blogBaseUrl: 'https://www.hinatazaka46.com',
        description: 'Hinatazaka46 Messages & Blogs',
        logoUrl: 'https://cdn.hinatazaka46.com/files/14/hinata/img/favicons/apple-touch-icon.png',
    },
    {
        id: 'sakurazaka46',
        name: 'Sakurazaka46',
        displayName: '櫻坂46',
        shortCode: 'SA',
        // Use lighter pink gradient for softer appearance
        color: 'from-[#f7a6c9] to-[#E85298]',
        bgColor: 'bg-[#E85298]',
        blogBaseUrl: 'https://sakurazaka46.com',
        description: 'Sakurazaka46 Messages & Blogs',
        logoUrl: 'https://sakurazaka46.com/files/14/s46/favicons/apple-touch-icon-180x180.png',
    },
    {
        id: 'nogizaka46',
        name: 'Nogizaka46',
        displayName: '乃木坂46',
        shortCode: 'NO',
        color: 'from-[#7e1083] to-[#5a0b5e]',
        bgColor: 'bg-[#7e1083]',
        blogBaseUrl: 'https://www.nogizaka46.com',
        description: 'Nogizaka46 Messages & Blogs',
        logoUrl: 'https://www.nogizaka46.com/files/46/assets/config/apple-touch-icon.png',
    },
];

export const SERVICES_BY_ID: Record<string, ServiceDefinition> = Object.fromEntries(
    SERVICES.map((s) => [s.id, s])
);

export function getServiceById(id: string): ServiceDefinition | undefined {
    return SERVICES_BY_ID[id];
}

export function getServiceShortCode(id: string): string {
    return SERVICES_BY_ID[id]?.shortCode ?? id.slice(0, 2).toUpperCase();
}

export function getServiceDisplayName(id: string): string {
    return SERVICES_BY_ID[id]?.displayName ?? id;
}

export function getServiceColor(id: string): string {
    return SERVICES_BY_ID[id]?.color ?? 'from-gray-400 to-gray-500';
}

export function getServiceBgColor(id: string): string {
    return SERVICES_BY_ID[id]?.bgColor ?? 'bg-gray-500';
}

export function getServiceBlogBaseUrl(id: string): string {
    return SERVICES_BY_ID[id]?.blogBaseUrl ?? '';
}

export function getServiceLogoUrl(id: string): string | undefined {
    return SERVICES_BY_ID[id]?.logoUrl;
}
