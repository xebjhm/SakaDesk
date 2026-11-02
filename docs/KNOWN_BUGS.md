# Known Bugs

## 1. A chat may stay frozen if its last page is exactly 200 messages
Rare edge case left after the frozen-chat fix below. If a chat was synced from
its very first message, its whole history is an exact multiple of 200 messages,
and the member posts nothing new, sync for that chat keeps failing (it cannot tell the true end of the history from a
dropped page). It recovers on its own as soon as the member posts again.

## Resolved

### Some chats stopped receiving new messages (0.3.2–0.3.3)
Chats whose sync position sat at their oldest message (often official group
channels, or members whose history starts at your subscription date) failed
on every sync and froze. Fixed by updating the sync library (pysaka 0.4.4);
missed messages are filled in on the next sync.

### Lapsed subscriptions stayed "online" (0.3.2–0.3.3)
Sync stopped checking subscriptions you didn't renew, so they never moved to
the offline section. Sync checks them again.

### Auto-expand/collapse for transcriptions and translations
Message transcriptions and translations expand when they finish and collapse
when you scroll away or switch conversations. Blog translations now behave the
same, with a show/hide toggle on the "✓ translated" badge.

### Copying a blog image to the clipboard failed
Only blog images not backed up locally (blog full backup off, the default)
failed, because the official image server blocks direct in-app downloads.
Copy now fetches them through the app, like Save.

### Subscription streak wording
The streak line (購読して 128 日間！) was assembled from separate fragments. Each
language now has one natural sentence (メンバーシップ継続 128 日！).

### Three-dot menu in the fullscreen video player not showing
The menu was rendered outside the fullscreen element; it is now rendered inside
the player while fullscreen.

### Window size and position not restored after upgrade/reinstall
Window geometry is now stored in `settings.json` in the app data folder (a
legacy separate file is migrated once), so it survives upgrades and reinstalls.

### Interrupted initial sync could strand message media
If the initial sync was interrupted (app closed, network drop, crash) partway
through downloading a batch of message media, the sync cursor could advance
past messages whose images/videos never finished downloading, permanently
skipping that media on future syncs. This is now prevented: the sync cursor
is held behind any message whose media has not been confirmed on disk. For
members affected before this fix, use **Settings → Sync → Verify & fix
media** to scan for and re-download any missing media.
