# Member Data Refactoring Design

**Date:** 2026-01-17
**Status:** Approved

## Overview

Create a single source of truth for member data that is human-maintainable, supports multiple idol groups, and uses color names instead of hex values.

## File Structure

```
data/
├── colors.json              # Per-group color palettes
└── members/
    ├── hinatazaka.json      # Hinatazaka46 members
    ├── sakurazaka.json      # Sakurazaka46 members
    └── nogizaka.json        # Nogizaka46 members
```

## Data Formats

### colors.json

Per-group color palettes allowing different hex values per group:

```json
{
  "hinatazaka": [
    { "id": "white", "nameJp": "ホワイト", "nameEn": "White", "hex": "#ffffff" },
    { "id": "sakura_pink", "nameJp": "サクラピンク", "nameEn": "Sakura Pink", "hex": "#ff9ccb" }
  ],
  "sakurazaka": [...],
  "nogizaka": [...]
}
```

### members/{group}.json

Member data using color IDs (snake_case) instead of hex values:

```json
{
  "meta": {
    "group": "hinatazaka",
    "updated": "2026-01-17"
  },
  "members": [
    {
      "blogId": "12",
      "nameKanji": "金村美玖",
      "nameHiragana": "かねむらみく",
      "nameRomaji": "Kanemura Miku",
      "generation": 2,
      "oshiColors": ["pastel_blue", "yellow"],
      "status": "active"
    }
  ]
}
```

**Fields:**
- `blogId`: String ID used by the blog system
- `nameKanji`: Japanese kanji name
- `nameHiragana`: Japanese hiragana reading
- `nameRomaji`: Romanized name (First Last order)
- `generation`: Number (1, 2, 3, 4, 5)
- `oshiColors`: Array of color IDs from colors.json
- `status`: "active" or "graduated"

## TypeScript Integration

### frontend/src/data/memberData.ts

```typescript
import colorsData from '../../../data/colors.json';
import hinatazakaData from '../../../data/members/hinatazaka.json';
// ... other groups

// Types
export interface ColorDefinition {
  id: string;
  nameJp: string;
  nameEn: string;
  hex: string;
}

export interface MemberData {
  blogId: string;
  nameKanji: string;
  nameHiragana: string;
  nameRomaji: string;
  generation: number;
  oshiColors: string[];
  status: 'active' | 'graduated';
}

export type GroupId = 'hinatazaka' | 'sakurazaka' | 'nogizaka';

// Color lookup
export function getColorPalette(group: GroupId): ColorDefinition[];
export function resolveColorHex(colorId: string, group: GroupId): string | null;

// Member lookup
export function getMembers(group: GroupId): MemberData[];
export function getMemberByBlogId(blogId: string, group: GroupId): MemberData | null;
export function getMemberPenlightHex(member: MemberData, group: GroupId): [string, string];
```

### Backward Compatibility

`frontend/src/data/memberColors.ts` will re-export from memberData.ts:

```typescript
// Backward compatibility - re-export with legacy names
export { getColorPalette as OSHI_COLOR_PALETTE } from './memberData';
// ... other compatibility exports
```

## Files to Clean Up

**Delete:**
- `frontend/member_penlight_color.json` - Replaced by data/colors.json and data/members/

**Replace:**
- `frontend/src/data/memberColors.ts` - New implementation with re-exports for compatibility

## Migration Notes

1. All 30 Hinatazaka members will be migrated from current memberColors.ts
2. Sakurazaka and Nogizaka files start empty (placeholder)
3. Existing components using MEMBER_COLORS continue to work via re-exports
