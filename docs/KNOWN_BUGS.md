# Known Bugs

## 1. Clipboard for blog not working
Copy functionality broken in blog context.

## 2. Three-dot menu in fullscreen video player not showing
Likely z-index/z-depth issue where the menu renders behind the fullscreen overlay.

## 3. i18n text for continuous subscription needs adjustment
The subscription duration text (メンバーシップ継続 / Subscribed for X days) wording needs refinement.

## 4. Window size and location storage
Should be stored in settings.json instead of a separate file. Currently doesn't load after app upgrade or reinstall even though the config file still exists on disk.

## 5. Auto-expand/collapse for transcription and translation
After transcription or translation finishes, the result should automatically expand. Should automatically collapse when the user scrolls away or switches to a different conversation/blog. Goal: minimize unnecessary user inputs.

## Resolved

### Interrupted initial sync could strand message media
If the initial sync was interrupted (app closed, network drop, crash) partway
through downloading a batch of message media, the sync cursor could advance
past messages whose images/videos never finished downloading, permanently
skipping that media on future syncs. This is now prevented: the sync cursor
is held behind any message whose media has not been confirmed on disk. For
members affected before this fix, use **Settings → Sync → Verify & fix
media** to scan for and re-download any missing media.
