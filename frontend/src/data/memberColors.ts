// frontend/src/data/memberColors.ts
// Hinatazaka46 Member Penlight Colors for HakoDesk
// IDs are the ct parameter values from the official website (verified 2026-01-16)

export interface MemberColor {
    id: string;
    nameJp: string;
    nameEn: string;
    generation: '2nd' | '3rd' | '4th' | '5th';
    penlightHex: [string, string];
}

export const GENERATION_LABELS: Record<string, string> = {
    '2nd': '2nd Gen',
    '3rd': '3rd Gen',
    '4th': '4th Gen',
    '5th': '5th Gen',
};

export const MEMBER_COLORS: MemberColor[] = [
    // Mascot (ct=000)
    { id: '000', nameJp: 'ポカ', nameEn: 'Poka', generation: '2nd', penlightHex: ['#ffea00', '#ff9ccb'] },

    // 2nd Generation (4 members)
    { id: '12', nameJp: '金村美玖', nameEn: 'Kanemura Miku', generation: '2nd', penlightHex: ['#7cc7e8', '#ffea00'] },
    { id: '13', nameJp: '河田陽菜', nameEn: 'Kawata Hina', generation: '2nd', penlightHex: ['#ffea00', '#ff9ccb'] },
    { id: '14', nameJp: '小坂菜緒', nameEn: 'Kosaka Nao', generation: '2nd', penlightHex: ['#ffffff', '#b25ccc'] },
    { id: '18', nameJp: '松田好花', nameEn: 'Matsuda Konoka', generation: '2nd', penlightHex: ['#5dc2b5', '#ff9ccb'] },

    // 3rd Generation (4 members)
    { id: '21', nameJp: '上村ひなの', nameEn: 'Kamimura Hinano', generation: '3rd', penlightHex: ['#00a968', '#ff3333'] },
    { id: '22', nameJp: '髙橋未来虹', nameEn: 'Takahashi Mikuni', generation: '3rd', penlightHex: ['#29b74d', '#8a2be2'] },
    { id: '23', nameJp: '森本茉莉', nameEn: 'Morimoto Marie', generation: '3rd', penlightHex: ['#0055ff', '#ff8c00'] },
    { id: '24', nameJp: '山口陽世', nameEn: 'Yamaguchi Haruyo', generation: '3rd', penlightHex: ['#5dc2b5', '#ffea00'] },

    // 4th Generation (11 members)
    { id: '25', nameJp: '石塚瑶季', nameEn: 'Ishizuka Tamaki', generation: '4th', penlightHex: ['#ff9ccb', '#ff8c00'] },
    { id: '27', nameJp: '小西夏菜実', nameEn: 'Konishi Nanami', generation: '4th', penlightHex: ['#0055ff', '#8a2be2'] },
    { id: '28', nameJp: '清水理央', nameEn: 'Shimizu Rio', generation: '4th', penlightHex: ['#7cc7e8', '#ff9ccb'] },
    { id: '29', nameJp: '正源司陽子', nameEn: 'Shogenji Yoko', generation: '4th', penlightHex: ['#ff3333', '#ff8c00'] },
    { id: '30', nameJp: '竹内希来里', nameEn: 'Takeuchi Kirari', generation: '4th', penlightHex: ['#ffea00', '#ff3333'] },
    { id: '31', nameJp: '平尾帆夏', nameEn: 'Hirao Honoka', generation: '4th', penlightHex: ['#7cc7e8', '#ff8c00'] },
    { id: '32', nameJp: '平岡海月', nameEn: 'Hiraoka Mitsuki', generation: '4th', penlightHex: ['#0055ff', '#ffea00'] },
    { id: '33', nameJp: '藤嶌果歩', nameEn: 'Fujishima Kaho', generation: '4th', penlightHex: ['#ff9ccb', '#0055ff'] },
    { id: '34', nameJp: '宮地すみれ', nameEn: 'Miyachi Sumire', generation: '4th', penlightHex: ['#b25ccc', '#ff3333'] },
    { id: '35', nameJp: '山下葉留花', nameEn: 'Yamashita Haruka', generation: '4th', penlightHex: ['#ffffff', '#00a968'] },
    { id: '36', nameJp: '渡辺莉奈', nameEn: 'Watanabe Rina', generation: '4th', penlightHex: ['#0055ff', '#ffffff'] },

    // 5th Generation (10 members)
    { id: '37', nameJp: '大田美月', nameEn: 'Ota Mizuki', generation: '5th', penlightHex: ['#ff9ccb', '#ff1493'] },
    { id: '38', nameJp: '大野愛実', nameEn: 'Ono Manami', generation: '5th', penlightHex: ['#ff3333', '#ff3333'] },
    { id: '39', nameJp: '片山紗希', nameEn: 'Katayama Saki', generation: '5th', penlightHex: ['#7cc7e8', '#7cc7e8'] },
    { id: '40', nameJp: '蔵盛妃那乃', nameEn: 'Kuramori Hinano', generation: '5th', penlightHex: ['#ff9ccb', '#ff3333'] },
    { id: '41', nameJp: '坂井新奈', nameEn: 'Sakai Nina', generation: '5th', penlightHex: ['#ffffff', '#ffffff'] },
    { id: '42', nameJp: '佐藤優羽', nameEn: 'Sato Yu', generation: '5th', penlightHex: ['#00a968', '#00a968'] },
    { id: '43', nameJp: '下田衣珠季', nameEn: 'Shimoda Izuki', generation: '5th', penlightHex: ['#7cc7e8', '#00a968'] },
    { id: '44', nameJp: '高井俐香', nameEn: 'Takai Rika', generation: '5th', penlightHex: ['#8a2be2', '#ffea00'] },
    { id: '45', nameJp: '鶴崎仁香', nameEn: 'Tsurusaki Niko', generation: '5th', penlightHex: ['#ffea00', '#ff8c00'] },
    { id: '46', nameJp: '松尾桜', nameEn: 'Matsuo Sakura', generation: '5th', penlightHex: ['#ff9ccb', '#ffffff'] },
];

// Create a lookup map for quick access by member ID, Japanese name, or English name
export const MEMBER_COLOR_MAP: Map<string, MemberColor> = new Map(
    MEMBER_COLORS.flatMap(m => [
        [m.id, m],
        [m.nameJp, m],
        [m.nameEn, m],
    ])
);

// Get member colors by name (supports ID, Japanese or English name)
export function getMemberColors(name: string): [string, string] | null {
    const member = MEMBER_COLOR_MAP.get(name);
    return member?.penlightHex ?? null;
}

// Extract kanji-only from API name format (e.g., "松田 好花まつだ このか" → "松田好花")
// API format: "姓 名せい めい" (kanji with space + hiragana reading)
function extractKanjiFromApiName(apiName: string): string {
    // Remove spaces first
    const noSpaces = apiName.replace(/\s+/g, '');
    // Remove hiragana characters (readings)
    const kanjiOnly = noSpaces.replace(/[\u3040-\u309F]/g, '');
    return kanjiOnly;
}

// Get kanji-only member name from API name format
// Looks up MEMBER_COLORS to find the proper nameJp, with fallback to extracted kanji
export function getMemberNameJp(apiName: string): string {
    // First try direct lookup
    const directMatch = MEMBER_COLOR_MAP.get(apiName);
    if (directMatch) return directMatch.nameJp;

    // Try without spaces
    const noSpaces = apiName.replace(/\s+/g, '');
    const noSpacesMatch = MEMBER_COLOR_MAP.get(noSpaces);
    if (noSpacesMatch) return noSpacesMatch.nameJp;

    // Extract kanji and try lookup
    const kanjiOnly = extractKanjiFromApiName(apiName);
    const kanjiMatch = MEMBER_COLOR_MAP.get(kanjiOnly);
    if (kanjiMatch) return kanjiMatch.nameJp;

    // Fallback: return extracted kanji (or original if extraction fails)
    return kanjiOnly || apiName;
}

// Generate CSS gradient from penlight colors
export function getPenlightGradient(colors: [string, string], angle: number = 135): string {
    return `linear-gradient(${angle}deg, ${colors[0]}, ${colors[1]})`;
}

// Generate CSS box-shadow glow effect from penlight colors
export function getPenlightGlow(colors: [string, string], intensity: number = 0.5): string {
    return `0 0 20px ${colors[0]}${Math.round(intensity * 255).toString(16).padStart(2, '0')}, 0 0 40px ${colors[1]}${Math.round(intensity * 0.5 * 255).toString(16).padStart(2, '0')}`;
}
