# Favorites Feature Design

> **Created:** 2026-01-13
> **Status:** Ready for Implementation

## Overview

Server-side favorites system that lets users star/unstar messages. Syncs with official app server.

## Data Flow

```
User right-clicks message → Context menu appears
  → User clicks "Add to favorites"
  → Frontend calls POST /api/favorites/{message_id}
  → Backend calls pyhako.add_favorite(session, message_id)
  → Backend updates local messages.json
  → Frontend updates message.is_favorite = true
  → Blue star indicator appears on message
```

## Backend

### New File: `backend/api/favorites.py`

```python
router = APIRouter(prefix="/api/favorites", tags=["favorites"])

@router.post("/{message_id}")
async def add_favorite(message_id: int):
    """Add message to favorites (server-side)."""
    # 1. Call pyhako.add_favorite()
    # 2. Update local messages.json
    # 3. Return success

@router.delete("/{message_id}")
async def remove_favorite(message_id: int):
    """Remove message from favorites."""
    # 1. Call pyhako.remove_favorite()
    # 2. Update local messages.json
    # 3. Return success
```

### Local Cache Update

When toggling favorites, update the local `messages.json` file:
1. Find the message by ID in all member directories
2. Update `is_favorite` field
3. Save file

This ensures favorite status persists across app restarts without re-syncing.

## Frontend

### Interaction Pattern

| Input | Action |
|-------|--------|
| Right-click on message | Show context menu |
| Long-press on message (touch) | Show context menu |

**No hover toolbar** - keeps UI clean while scrolling.

### Context Menu Items

```
┌─────────────────────────┐
│ ⭐ Add to favorites     │  ← or "Remove from favorites"
│ ─────────────────────── │
│ 📋 Copy text            │  ← future
│ 🖼️ Copy image           │  ← future (if media message)
└─────────────────────────┘
```

### Visual Indicator

**Favorited messages only** show a small blue star in the message header row (top-right):

```
┌────────────────────────────────────────────────────┐
│ [👤] 高井 俐香  2026/01/12 12:30              ⭐   │ ← star in header, top-right
├────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────┐   │
│ │              [image content]                 │   │
│ └──────────────────────────────────────────────┘   │
│ 実家のヒトモシくん                                  │
└────────────────────────────────────────────────────┘
```

- Star color: Brand blue (matches app theme)
- Position: Header row (with avatar/name/timestamp), far right
- Size: Small, subtle (14-16px)
- Non-favorited messages: No indicator (clean)

### Components to Create/Modify

1. **MessageContextMenu.tsx** (new)
   - Popup menu with favorite toggle
   - Position near click/long-press location

2. **MessageBubble.tsx** (modify)
   - Add right-click handler → show context menu
   - Add long-press handler → show context menu
   - Add blue star indicator for favorited messages

3. **App.tsx** (modify)
   - Add `onToggleFavorite(messageId)` handler
   - Optimistic update + API call

### State Management

```typescript
// Optimistic update pattern
const handleToggleFavorite = async (messageId: number, currentState: boolean) => {
  // 1. Optimistically update UI
  setMessages(msgs => msgs.map(m =>
    m.id === messageId ? { ...m, is_favorite: !currentState } : m
  ));

  // 2. Call API
  try {
    if (currentState) {
      await fetch(`/api/favorites/${messageId}`, { method: 'DELETE' });
    } else {
      await fetch(`/api/favorites/${messageId}`, { method: 'POST' });
    }
  } catch (error) {
    // 3. Revert on failure
    setMessages(msgs => msgs.map(m =>
      m.id === messageId ? { ...m, is_favorite: currentState } : m
    ));
    // Show error toast
  }
};
```

## Implementation Order

1. **Backend API** - `backend/api/favorites.py`
   - POST/DELETE endpoints
   - Local messages.json update logic

2. **Frontend Context Menu** - `MessageContextMenu.tsx`
   - Menu component with favorite option

3. **MessageBubble Integration**
   - Right-click handler
   - Long-press handler (use `useLongPress` hook)
   - Blue star indicator

4. **State Management**
   - Optimistic updates in App.tsx

## Testing

- [ ] Toggle favorite via right-click
- [ ] Toggle favorite via long-press (touch simulation)
- [ ] Verify server sync (check official app)
- [ ] Verify local messages.json update
- [ ] Verify indicator appears/disappears
- [ ] Error handling when offline
