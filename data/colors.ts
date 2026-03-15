// data/colors.ts
// Per-group penlight color palettes
// VSCode shows color swatches for hex values in TypeScript files

export interface ColorDefinition {
    id: string;
    nameJp: string;
    nameEn: string;
    hex: string;
}

export type GroupId = 'hinatazaka' | 'sakurazaka' | 'nogizaka';

export const COLORS: Record<GroupId, ColorDefinition[]> = {
    hinatazaka: [
        { id: 'white', nameJp: 'ホワイト', nameEn: 'White', hex: '#ffffff' },
        { id: 'sakura_pink', nameJp: 'サクラピンク', nameEn: 'Sakura Pink', hex: '#ff9ccb' },
        { id: 'pink', nameJp: 'ピンク', nameEn: 'Pink', hex: '#ff1493' },
        { id: 'passion_pink', nameJp: 'パッションピンク', nameEn: 'Passion Pink', hex: '#ff69b4' },
        { id: 'red', nameJp: 'レッド', nameEn: 'Red', hex: '#ff3333' },
        { id: 'orange', nameJp: 'オレンジ', nameEn: 'Orange', hex: '#ff8c00' },
        { id: 'yellow', nameJp: 'イエロー', nameEn: 'Yellow', hex: '#ffea00' },
        { id: 'light_green', nameJp: 'ライトグリーン', nameEn: 'Light Green', hex: '#90ee90' },
        { id: 'green', nameJp: 'グリーン', nameEn: 'Green', hex: '#29b74d' },
        { id: 'pearl_green', nameJp: 'パールグリーン', nameEn: 'Pearl Green', hex: '#5dc2b5' },
        { id: 'emerald_green', nameJp: 'エメラルドグリーン', nameEn: 'Emerald Green', hex: '#00a968' },
        { id: 'pastel_blue', nameJp: 'パステルブルー', nameEn: 'Pastel Blue', hex: '#7cc7e8' },
        { id: 'blue', nameJp: 'ブルー', nameEn: 'Blue', hex: '#0055ff' },
        { id: 'purple', nameJp: 'パープル', nameEn: 'Purple', hex: '#8a2be2' },
        { id: 'violet', nameJp: 'バイオレット', nameEn: 'Violet', hex: '#b25ccc' },
    ],
    sakurazaka: [
        { id: 'white', nameJp: 'ホワイト', nameEn: 'White', hex: '#ffffff' },
        { id: 'sakura_pink', nameJp: 'サクラピンク', nameEn: 'Sakura Pink', hex: '#ff9ccb' },
        { id: 'pink', nameJp: 'ピンク', nameEn: 'Pink', hex: '#ff1493' },
        { id: 'passion_pink', nameJp: 'パッションピンク', nameEn: 'Passion Pink', hex: '#ff69b4' },
        { id: 'red', nameJp: 'レッド', nameEn: 'Red', hex: '#ff3333' },
        { id: 'orange', nameJp: 'オレンジ', nameEn: 'Orange', hex: '#ff8c00' },
        { id: 'yellow', nameJp: 'イエロー', nameEn: 'Yellow', hex: '#ffea00' },
        { id: 'light_green', nameJp: 'ライトグリーン', nameEn: 'Light Green', hex: '#90ee90' },
        { id: 'green', nameJp: 'グリーン', nameEn: 'Green', hex: '#29b74d' },
        { id: 'pearl_green', nameJp: 'パールグリーン', nameEn: 'Pearl Green', hex: '#5dc2b5' },
        { id: 'emerald_green', nameJp: 'エメラルドグリーン', nameEn: 'Emerald Green', hex: '#00a968' },
        { id: 'pastel_blue', nameJp: 'パステルブルー', nameEn: 'Pastel Blue', hex: '#7cc7e8' },
        { id: 'blue', nameJp: 'ブルー', nameEn: 'Blue', hex: '#0055ff' },
        { id: 'purple', nameJp: 'パープル', nameEn: 'Purple', hex: '#8a2be2' },
        { id: 'violet', nameJp: 'バイオレット', nameEn: 'Violet', hex: '#b25ccc' },
    ],
    nogizaka: [
        { id: 'white', nameJp: '白', nameEn: 'White', hex: '#ffffff' },
        { id: 'orange', nameJp: 'オレンジ', nameEn: 'Orange', hex: '#ffa500' },
        { id: 'blue', nameJp: '青', nameEn: 'Blue', hex: '#0000ff' },
        { id: 'yellow', nameJp: '黄', nameEn: 'Yellow', hex: '#ffff00' },
        { id: 'purple', nameJp: '紫', nameEn: 'Purple', hex: '#800080' },
        { id: 'green', nameJp: '緑', nameEn: 'Green', hex: '#008000' },
        { id: 'pink', nameJp: 'ピンク', nameEn: 'Pink', hex: '#ffc0cb' },
        { id: 'red', nameJp: '赤', nameEn: 'Red', hex: '#ff0000' },
        { id: 'light_blue', nameJp: '水', nameEn: 'Light Blue', hex: '#00bfff' },
        { id: 'yellow_green', nameJp: '黄緑', nameEn: 'Yellow-Green', hex: '#9acd32' },
        { id: 'turquoise', nameJp: 'ターコイズ', nameEn: 'Turquoise', hex: '#40e0d0' },
    ],
};
