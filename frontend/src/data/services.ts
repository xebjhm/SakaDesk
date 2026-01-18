// frontend/src/data/services.ts
// Single source of truth for service definitions

export interface ServiceDefinition {
    id: string;
    name: string;
    displayName: string;
    shortCode: string;
    color: string;          // Gradient classes for UI elements
    bgColor: string;        // Solid bg class for icons/badges
    blogBaseUrl: string;    // Base URL for blog content normalization
    description: string;
}

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
    },
    {
        id: 'sakurazaka46',
        name: 'Sakurazaka46',
        displayName: '櫻坂46',
        shortCode: 'SA',
        color: 'from-[#f19db5] to-[#e87a9a]',
        bgColor: 'bg-[#E85298]',
        blogBaseUrl: 'https://sakurazaka46.com',
        description: 'Sakurazaka46 Messages & Blogs',
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
