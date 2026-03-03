// frontend/src/data/services.ts
// Single source of truth for service definitions
// Colors are derived from the brand palette for consistency

import { BRAND_COLORS } from '../config/colors/palette';

// Note: Colors are defined statically for Tailwind JIT compatibility.
// Canonical color values live in config/colors/palette.ts - keep in sync.

export interface ServiceDefinition {
    id: string;
    name: string;
    displayName: string;
    shortCode: string;
    color: string;          // Gradient classes for UI elements
    bgColor: string;        // Solid bg class for icons/badges
    primaryColor: string;   // Hex color for dynamic styling (rings, tints)
    blogBaseUrl: string;    // Base URL for blog content normalization
    description: string;
    logoUrl: string;        // Official logo URL (hotlinked from official site)
}

// Tailwind requires static class names at build time.
// These colors are derived from BRAND_COLORS in palette.ts - keep them in sync.
// hinatazaka: primary=#5bbfe5, primaryDark=#4aa8cc
// sakurazaka: primary=#f19cb4, primaryDark=#E85298
// nogizaka: primary=#7e2483, primaryDark=#5a0b5e
// yodel: primary=#5a8a6a, primaryDark=#3d6b4f

export const SERVICES: ServiceDefinition[] = [
    {
        id: 'hinatazaka46',
        name: 'Hinatazaka46',
        displayName: '日向坂46',
        shortCode: 'HI',
        color: 'from-[#5bbfe5] to-[#4aa8cc]',
        bgColor: 'bg-[#5bbfe5]',
        primaryColor: BRAND_COLORS.hinatazaka.primary,
        blogBaseUrl: 'https://www.hinatazaka46.com',
        description: 'Hinatazaka46 Messages & Blogs',
        logoUrl: 'https://cdn.hinatazaka46.com/files/14/wkeyakifes2021/assets/images/logo_hinata.svg',
    },
    {
        id: 'sakurazaka46',
        name: 'Sakurazaka46',
        displayName: '櫻坂46',
        shortCode: 'SA',
        color: 'from-[#f19cb4] to-[#E85298]',
        bgColor: 'bg-[#f19cb4]',
        primaryColor: BRAND_COLORS.sakurazaka.primary,
        blogBaseUrl: 'https://sakurazaka46.com',
        description: 'Sakurazaka46 Messages & Blogs',
        logoUrl: 'https://sakurazaka46.com/files/14/s46/img/about/about-logo.svg',
    },
    {
        id: 'nogizaka46',
        name: 'Nogizaka46',
        displayName: '乃木坂46',
        shortCode: 'NO',
        color: 'from-[#7e2483] to-[#5a0b5e]',
        bgColor: 'bg-[#7e2483]',
        primaryColor: BRAND_COLORS.nogizaka.primary,
        blogBaseUrl: 'https://www.nogizaka46.com',
        description: 'Nogizaka46 Messages & Blogs',
        logoUrl: 'https://www.nogizaka46.com/files/46/assets/img/logo.png',
    },
    {
        id: 'yodel',
        name: 'Yodel',
        displayName: 'Yodel',
        shortCode: 'YO',
        color: 'from-[#5a8a6a] to-[#3d6b4f]',
        bgColor: 'bg-[#5a8a6a]',
        primaryColor: BRAND_COLORS.yodel.primary,
        blogBaseUrl: 'https://service.yodel-app.com',
        description: 'Yodel Talk & Messages',
        logoUrl: 'https://service.yodel-app.com/assets/assets/icon/yodel_logo.svg',
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

export function getServicePrimaryColor(id: string): string {
    return SERVICES_BY_ID[id]?.primaryColor ?? '#6b7280';
}

const SERVICES_BY_DISPLAY_NAME: Record<string, ServiceDefinition> = Object.fromEntries(
    SERVICES.map((s) => [s.displayName, s])
);

export function getServiceIdFromDisplayName(displayName: string): string | undefined {
    return SERVICES_BY_DISPLAY_NAME[displayName]?.id;
}
