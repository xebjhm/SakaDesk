// frontend/src/data/services.ts
// Service metadata definitions. Colors come from config/serviceThemes.ts (single source of truth).

import { getServiceTheme } from '../config/serviceThemes';

export interface ServiceDefinition {
    id: string;
    name: string;
    displayName: string;
    shortCode: string;
    blogBaseUrl: string;    // Base URL for blog content normalization
    logoUrl: string;        // Official logo URL (hotlinked from official site)
}

export const SERVICES: ServiceDefinition[] = [
    {
        id: 'nogizaka46',
        name: 'Nogizaka46',
        displayName: '乃木坂46',
        shortCode: 'NO',
        blogBaseUrl: 'https://www.nogizaka46.com',
        logoUrl: 'https://www.nogizaka46.com/files/46/assets/img/logo.png',
    },
    {
        id: 'sakurazaka46',
        name: 'Sakurazaka46',
        displayName: '櫻坂46',
        shortCode: 'SA',
        blogBaseUrl: 'https://sakurazaka46.com',
        logoUrl: 'https://sakurazaka46.com/files/14/s46/img/about/about-logo.svg',
    },
    {
        id: 'hinatazaka46',
        name: 'Hinatazaka46',
        displayName: '日向坂46',
        shortCode: 'HI',
        blogBaseUrl: 'https://www.hinatazaka46.com',
        logoUrl: 'https://cdn.hinatazaka46.com/files/14/wkeyakifes2021/assets/images/logo_hinata.svg',
    },
    {
        id: 'yodel',
        name: 'Yodel',
        displayName: 'Yodel',
        shortCode: 'YO',
        blogBaseUrl: 'https://service.yodel-app.com',
        logoUrl: 'https://service.yodel-app.com/icons/Icon-192.png',
    },
];

/** Default service display order. Used as initial value for appStore.serviceOrder. */
export const DEFAULT_SERVICE_ORDER: string[] = SERVICES.map((s) => s.id);

/** Return SERVICES sorted by a custom order array. Unknown IDs sort to end. */
export function getOrderedServiceDefs(order: string[]): ServiceDefinition[] {
    return [...SERVICES].sort((a, b) => {
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    });
}

/** Sort any array by the global service order. `getId` extracts the service ID from each item. */
export function sortByServiceOrder<T>(items: T[], order: string[], getId: (item: T) => string): T[] {
    return [...items].sort((a, b) => {
        const ai = order.indexOf(getId(a));
        const bi = order.indexOf(getId(b));
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    });
}

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

export function getServiceBlogBaseUrl(id: string): string {
    return SERVICES_BY_ID[id]?.blogBaseUrl ?? '';
}

export function getServiceLogoUrl(id: string): string | undefined {
    return SERVICES_BY_ID[id]?.logoUrl;
}

/** Get the primary color for a service. Reads from serviceThemes (single source of truth). */
export function getServicePrimaryColor(id: string): string {
    return getServiceTheme(id).primaryColor;
}

const SERVICES_BY_DISPLAY_NAME: Record<string, ServiceDefinition> = Object.fromEntries(
    SERVICES.map((s) => [s.displayName, s])
);

export function getServiceIdFromDisplayName(displayName: string): string | undefined {
    return SERVICES_BY_DISPLAY_NAME[displayName]?.id;
}
