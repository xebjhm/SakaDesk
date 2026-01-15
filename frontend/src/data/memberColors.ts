// frontend/src/data/memberColors.ts
// Hinatazaka46 Member Penlight Colors for HakoDesk

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
    // 2nd Generation
    { id: 'kanemura_miku', nameJp: '金村美玖', nameEn: 'Kanemura Miku', generation: '2nd', penlightHex: ['#7cc7e8', '#ffea00'] },
    { id: 'kawata_hina', nameJp: '河田陽菜', nameEn: 'Kawata Hina', generation: '2nd', penlightHex: ['#ffea00', '#ff9ccb'] },
    { id: 'kosaka_nao', nameJp: '小坂菜緒', nameEn: 'Kosaka Nao', generation: '2nd', penlightHex: ['#ffffff', '#b25ccc'] },
    { id: 'matsuda_konoka', nameJp: '松田好花', nameEn: 'Matsuda Konoka', generation: '2nd', penlightHex: ['#5dc2b5', '#ff9ccb'] },

    // 3rd Generation
    { id: 'kamimura_hinano', nameJp: '上村ひなの', nameEn: 'Kamimura Hinano', generation: '3rd', penlightHex: ['#00a968', '#ff3333'] },
    { id: 'takahashi_mikuni', nameJp: '髙橋未来虹', nameEn: 'Takahashi Mikuni', generation: '3rd', penlightHex: ['#29b74d', '#8a2be2'] },
    { id: 'morimoto_marie', nameJp: '森本茉莉', nameEn: 'Morimoto Marie', generation: '3rd', penlightHex: ['#0055ff', '#ff8c00'] },
    { id: 'yamaguchi_haruyo', nameJp: '山口陽世', nameEn: 'Yamaguchi Haruyo', generation: '3rd', penlightHex: ['#5dc2b5', '#ffea00'] },

    // 4th Generation
    { id: 'ishizuka_tamaki', nameJp: '石塚瑶季', nameEn: 'Ishizuka Tamaki', generation: '4th', penlightHex: ['#ff9ccb', '#ff8c00'] },
    { id: 'konishi_nanami', nameJp: '小西夏菜実', nameEn: 'Konishi Nanami', generation: '4th', penlightHex: ['#0055ff', '#8a2be2'] },
    { id: 'shimizu_rio', nameJp: '清水理央', nameEn: 'Shimizu Rio', generation: '4th', penlightHex: ['#7cc7e8', '#ff9ccb'] },
    { id: 'shogenji_yoko', nameJp: '正源司陽子', nameEn: 'Shogenji Yoko', generation: '4th', penlightHex: ['#ff3333', '#ff8c00'] },
    { id: 'takeuchi_kirari', nameJp: '竹内希来里', nameEn: 'Takeuchi Kirari', generation: '4th', penlightHex: ['#ffea00', '#ff3333'] },
    { id: 'hirao_honoka', nameJp: '平尾帆夏', nameEn: 'Hirao Honoka', generation: '4th', penlightHex: ['#7cc7e8', '#ff8c00'] },
    { id: 'hiraoka_mitsuki', nameJp: '平岡海月', nameEn: 'Hiraoka Mitsuki', generation: '4th', penlightHex: ['#0055ff', '#ffea00'] },
    { id: 'fujishima_kaho', nameJp: '藤嶌果歩', nameEn: 'Fujishima Kaho', generation: '4th', penlightHex: ['#ff9ccb', '#0055ff'] },
    { id: 'miyachi_sumire', nameJp: '宮地すみれ', nameEn: 'Miyachi Sumire', generation: '4th', penlightHex: ['#b25ccc', '#ff3333'] },
    { id: 'yamashita_haruka', nameJp: '山下葉留花', nameEn: 'Yamashita Haruka', generation: '4th', penlightHex: ['#ffffff', '#00a968'] },
    { id: 'watanabe_rina', nameJp: '渡辺莉奈', nameEn: 'Watanabe Rina', generation: '4th', penlightHex: ['#0055ff', '#ffffff'] },

    // 5th Generation
    { id: 'ota_mizuki', nameJp: '大田美月', nameEn: 'Ota Mizuki', generation: '5th', penlightHex: ['#ff9ccb', '#ff1493'] },
    { id: 'ono_manami', nameJp: '大野愛実', nameEn: 'Ono Manami', generation: '5th', penlightHex: ['#ff3333', '#ff3333'] },
    { id: 'katayama_saki', nameJp: '片山紗希', nameEn: 'Katayama Saki', generation: '5th', penlightHex: ['#7cc7e8', '#7cc7e8'] },
    { id: 'kuramori_hinano', nameJp: '蔵盛妃那乃', nameEn: 'Kuramori Hinano', generation: '5th', penlightHex: ['#ff9ccb', '#ff3333'] },
    { id: 'sakai_nina', nameJp: '坂井新奈', nameEn: 'Sakai Nina', generation: '5th', penlightHex: ['#ffffff', '#ffffff'] },
    { id: 'sato_yu', nameJp: '佐藤優羽', nameEn: 'Sato Yu', generation: '5th', penlightHex: ['#00a968', '#00a968'] },
    { id: 'shimoda_izuki', nameJp: '下田衣珠季', nameEn: 'Shimoda Izuki', generation: '5th', penlightHex: ['#7cc7e8', '#00a968'] },
    { id: 'takai_rika', nameJp: '高井俐香', nameEn: 'Takai Rika', generation: '5th', penlightHex: ['#8a2be2', '#ffea00'] },
    { id: 'tsurusaki_niko', nameJp: '鶴崎仁香', nameEn: 'Tsurusaki Niko', generation: '5th', penlightHex: ['#ffea00', '#ff8c00'] },
    { id: 'matsuo_sakura', nameJp: '松尾桜', nameEn: 'Matsuo Sakura', generation: '5th', penlightHex: ['#ff9ccb', '#ffffff'] },
];

// Create a lookup map for quick access by member name
export const MEMBER_COLOR_MAP: Map<string, MemberColor> = new Map(
    MEMBER_COLORS.flatMap(m => [
        [m.nameJp, m],
        [m.nameEn, m],
        [m.id, m],
    ])
);

// Get member colors by name (supports Japanese or English name)
export function getMemberColors(name: string): [string, string] | null {
    const member = MEMBER_COLOR_MAP.get(name);
    return member?.penlightHex ?? null;
}

// Generate CSS gradient from penlight colors
export function getPenlightGradient(colors: [string, string], angle: number = 135): string {
    return `linear-gradient(${angle}deg, ${colors[0]}, ${colors[1]})`;
}

// Generate CSS box-shadow glow effect from penlight colors
export function getPenlightGlow(colors: [string, string], intensity: number = 0.5): string {
    return `0 0 20px ${colors[0]}${Math.round(intensity * 255).toString(16).padStart(2, '0')}, 0 0 40px ${colors[1]}${Math.round(intensity * 0.5 * 255).toString(16).padStart(2, '0')}`;
}
