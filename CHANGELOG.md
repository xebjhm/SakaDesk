# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Relive your archive with each member.** The new Memories page opens on a
  board with a moment from this day in past years and leads to On This Day
  with that whole day's messages, a photo album by month, your favorites on a
  cork board, and a memoir for each member. A memoir collects cards for her
  milestones, a month-by-month timeline and the times she called you by name.
- **Look back on your year with each member.** Memories also has a year
  recap: a short story of her messages, photos and voice from the year,
  a poster you can save, and a share image or video that blurs her photos.
  It opens on December 1 with the year so far, and past years stay on the
  shelf; with several members it starts with all of them together.
- **Listen, draw and leave notes in Memories.** A late-night voice radio with
  a sleep timer, a memory gacha with three draws a day, and a photo calendar
  that opens any day. Set an old day beside this year, see her day pieced
  together from different years, or pick a month's album cover; notes you
  leave on a day or a card come back a year later and stay on this PC.
- **Memories can now remind you.** SakaDesk can send a Windows notification
  for On This Day, members' birthdays, your membership anniversaries and the
  year recap, and, if you turn it on, when a foil card joins a binder.
  Clicking one opens that page in Memories, and nothing is shown while you
  are already in Memories. Each kind has its own switch in Settings, along
  with the time of day they arrive (Japan time).

### Changed
- **The media gallery and the blog photo album open fast, even with
  thousands of photos.** Photos and videos now show as small thumbnails that
  load as you scroll, with a colour preview while each one arrives, instead of
  loading every full-size photo at once. While SakaDesk is still preparing
  thumbnails in the background, both show how far it has got, or that it is
  paused.
- **Videos show a still frame in every gallery.** Video tiles now show a
  frame from the video instead of a blank square, prepared in the
  background and kept small on disk.
- **You can always tell when SakaDesk is still loading.** Chats, galleries,
  Memories, sign-in and settings show a clear loading state instead of a
  blank or frozen screen. Long waits explain what is happening and offer
  Cancel or Retry.
- **Fonts now come with the app.** SakaDesk no longer downloads its fonts from
  Google when it starts, so text looks right straight away even offline,
  behind a proxy or where Google is blocked. The installer is larger as a
  result.

### Fixed
- **Bug reports hide your nickname for every group.** Previously the
  nickname you use in each group's app could appear in a bug report's logs;
  it is now replaced, along with your Windows user name and archive folder.
- **No more red corner on the incoming-call window.** The rounded corners of
  the bottom-right call card are see-through again instead of showing a solid
  red patch, on every display scale.

### Security
- **Other programs and web pages can no longer use SakaDesk's local
  connection.** SakaDesk now answers only its own windows. Other apps, other
  Windows accounts on the same PC and web pages open in your browser can no
  longer read your archive, change settings or remove your sign-in through it,
  and their refused attempts no longer crowd out the log that bug reports
  include.
- **Installers no longer include a leftover sample of real messages.** A file
  with copies of a member's paid messages had been bundled with every version
  since the first release; it has been removed.
- **Blog posts and saved files can no longer take over SakaDesk.** A file
  saved from a blog post now only ever opens as a picture, video, voice clip
  or plain download, and blog images fetched for saving or copying must be
  real images from the official sites over a secure connection.
- **Links in blog posts and messages open in your browser.** A link can no
  longer replace SakaDesk's window with another site, and links to anything
  other than a web page are ignored. Search highlighting in a blog post can
  no longer turn the post's text into part of the page.
- **SakaDesk only runs the code it ships with.** The app now tells its window
  to refuse scripts, styles and fonts from anywhere else, as a second line of
  defence if hostile content ever slips through.
- **Data from the official sites can no longer place files outside your
  archive.** Member and post codes from the blog sites and ids from the
  message service are now checked before SakaDesk uses them in folder or file
  names, and anything that would lead outside your SakaDesk folder is
  skipped. Member photos are saved and shown only as pictures.
- **Only you can change where SakaDesk keeps your archive.** The output folder
  can now only be chosen with Browse, in Windows' own folder picker, and
  SakaDesk only opens files inside the group folders it creates there, so
  another program or a web page can no longer point it at your other files.
  Network locations, whole drives, system folders and your user folder itself
  are refused (a mapped drive letter works), and the folder you already use
  keeps working.

## [0.4.2] - 2026-11-10

### Added
- **Update from Settings.** Settings → Updates now has buttons to download
  the new version, follow its progress or cancel it, and install it, instead
  of only saying a new version is available. A version you skipped on the
  update icon can still be installed there.

### Fixed
- **Sync progress now matches what is really happening.** Groups now sync one at
  a time (乃木坂46, 櫻坂46, 日向坂46, then Yodel when several start together), so
  the sync window no longer shows one group while another downloads in the
  background. A group waiting its turn says so, the download bar always reaches
  the end (failed files are counted apart), and the remaining time only appears
  once it can be estimated honestly.
- **No more needless re-logins after the PC wakes up.** An expired sign-in is
  now renewed automatically in the background, so syncing continues without
  asking you to log in again.
- **A clear alert when you really need to log in again.** If a group's sign-in
  can no longer be renewed, SakaDesk shows one Windows notification (click it
  to log in) and a warning dot on the tray icon until you do. If you were only
  offline, the warning clears by itself once SakaDesk can reach the service
  again.
- **Read progress is no longer lost after a slow start.** If SakaDesk could not
  load your read progress at startup, it keeps trying and saves what you read
  in the meantime.
- **The bottom-right call window is just the call card.** The dark frame
  around it is gone.

## [0.4.1] - 2026-11-09

### Added
- **Sent letters show how many there are.** The sent-letters overview now
  shows the number of letters at the bottom, like Favorites.

### Fixed
- **In-app upgrades no longer fail with "file in use".** Clicking the update
  ring during a download started a second download, so the installer could
  not open; a click now does nothing while downloading (the small × cancels),
  and a cancel really stops the download. From 0.3.4 or 0.4.0, let the
  download finish without clicking, then click the ring when it turns green.
- **Your nickname appears in Windows notifications and Favorites.** The
  "%%%" placeholders in members' messages showed as is there; they now show
  your nickname, as in the chat.

## [0.4.0] - 2026-11-09

### Added
- **Sent letters open in a viewer.** It shows the letter image, the full text
  and a date link that jumps back to it in the chat. Click the image for the
  large view with zoom; the arrows always go in time order, and narrow windows
  give the letter more room.
- **Zoom photos with the mouse wheel.** In the photo viewer and the media
  gallery, scroll to zoom in where you point, or use the zoom buttons or a
  double-click; drag to move around a zoomed photo.
- **A Japanese-style calendar.** The date calendar marks Japanese public
  holidays (point at a day to see its name), shows Sundays and holidays in red
  and Saturdays in blue, and lets you click the month title to pick any year
  and month.
- **Small celebrations.** Your first complete sync ends with a short
  celebration, and a chat shows a card when a member passes 1,000, 5,000 or
  10,000 messages, or when your subscription reaches day 100 and each full
  year. Nothing needs to be closed, and reduced motion keeps them still.
- **Incoming calls while SakaDesk is in the background.** When a member sends
  a voice message while the app is hidden, minimised or behind other windows,
  a small call window rings at the bottom right of the screen; answer to play
  it there, or miss it and get a missed-call notification instead. It stays
  out of the way during fullscreen apps, presentations and Focus Assist, and
  you can turn it off in Settings.
- **SakaDesk keeps running in the system tray.** Closing the window now hides
  it to the tray and keeps syncing in the background, so notifications still
  arrive; use the tray icon to open the app, sync now, or quit. You can also
  start SakaDesk with Windows. Both are in Settings.
- **See a member's list icon, chat icon and call-screen photo.** Open them from
  the new buttons on the profile card, by clicking the large avatar, or with
  View images on a member's right-click menu. Copy and save work like other
  photos.
- **Avatar history.** Every time a member changes one of these images,
  SakaDesk keeps the old one; flip through them with the arrow keys and see
  when each was in use.
- **Messages from just before you subscribed.** After updating, the next sync
  adds the day or so of messages the member sent right before your first
  subscription, which the app never downloaded before. These recovered
  messages also show up in search.
- **Your sent letters are now kept in your archive**, even after a
  subscription ends, and they appear in the chat where you sent them, with
  the avatar you had at the time. Sent Letters in the chat menu shows them
  all; click one to open it in the letter viewer.
- **Dates stay at the top of the chat while you scroll.** Each day starts
  with a date label (Today, Yesterday, or the date); click it to open the
  calendar and jump to another day.
- **Your own nickname and avatar for each group are now archived.** Only those
  two are kept; other profile details are not stored.
- **Incoming calls for new voice messages.** Opening a member's chat whose
  newest voice message you haven't heard rings like a phone call; answer to
  play it, or decline and it rings again the next time you open the chat.
  You can turn this off in Settings.
- **Windows notifications for new messages.** Each chat with new messages
  gets one notification with their photo and a preview; click it
  to open the chat at that message. You can hide message content or turn
  notifications off in Settings.

### Changed
- **Grey text is darker** and easier to read, also on grey backgrounds such as
  the search footer and the background preview. Hinatazaka's unread covers now
  use the official app colours.
- **Arrows go older and newer.** In the photo, video and voice viewers and
  galleries, left goes to the older item and right to the newer one, whichever
  way the list is sorted. Images inside a blog post keep their reading order.
- **One tidy translate icon.** Every message has the same small, neutral
  translate icon at its bottom-right corner, next to the time. The Show text
  button under a voice message is neutral too.
- **Slim scrollbars.** Scrollbars are thin and rounded, and grow a little when
  you point at them.
- **The title bar matches the app on Windows 11** instead of the standard
  window colour.
- **Calmer colours.** The group colour now marks only where you are, what is
  selected and the main action. Secondary buttons, counts and tool panels are
  neutral.
- **The side feature list shows icons only.** Hover an icon to see its name.
- **Empty screens are friendlier.** An empty list now shows a soft circle, a
  short title and a hint instead of grey text.
- **Japanese text always uses Japanese letter shapes.** Member names,
  messages and blog titles are shown with Japanese letter shapes whatever
  language the app is in.
- **Favourites (推) hearts are pink in every group.** The heart on a member
  and the Favorite filter keep the same pink whichever group you are in.
- **Starred messages use one yellow star in every group** instead of the
  group colour.
- **Yodel now uses its own periwinkle colours.** The old green came from one
  member's page; Yodel screens now follow the Yodel logo colour.
- **A cleaner main window.** The add, search and settings buttons on the left
  now use SakaDesk's own soft colour, the feature list shares the group's
  background with the member list, and chats and blogs sit on one rounded
  page. The member list widens on large windows to
  show four or five members per row.
- **Chats are easier to read.** Messages sent in a row show the name, photo
  and time only once (hover a message to see its time), and the chat title
  shows the member's photo and how many days you have been subscribed.
- **One consistent colour design per group.** Badges, buttons, member
  names, links, dialogs and the voice player now follow each group's logo
  colours, so every group looks equally clear. The official title bars,
  sidebars and unread covers keep their official look.
- **Hovering a group in the left rail shows its Japanese name** (乃木坂46,
  櫻坂46, 日向坂46) instead of an internal id.
- **The sidebar no longer re-reads your whole archive every two seconds**, and
  it pauses while the window is minimized. Avatars load from your local
  archive, so they also show offline.
- **Logs no longer contain letter contents or signed image links**, so a
  diagnostics report is safer to share.
- **The sync screen says when it is scanning a chat's full history for the first
  time**, and the member count no longer runs past its total.
- **When the server is busy, a chat is retried on the next sync** instead of
  looking empty or missing messages until then.
- **Blogs match the new look.** The latest-posts grid, the reader and the
  timeline beside it now use the same design as the chats, keeping each
  group's soft background colours and each member's colours in the reader.
  Posts read at a comfortable width with more space between lines, dates
  follow your app language, and the older and newer posts float at the bottom.
- **Dialogs, menus and the photo viewer match the new look.** Settings, search,
  the date picker, favourites, the media and photo galleries, the member lists
  for blogs, About and every other window now share one calm design and one
  menu style; photos and videos still open in a dark full-screen viewer.
  App windows such as Settings, search and About use SakaDesk's own colours
  whichever group is open, while a chat's calendar, favourites, media and
  background windows use that group's colours. The sync repair rows in
  Settings say which group they act on.
- **Confirmations appear inside the app.** Resetting settings, deleting the
  blog backup, a deep re-sync and revealing all unread messages now ask in a
  SakaDesk window instead of a browser pop-up, with Cancel selected first.
- **The first-launch screens match the new look.** The terms, the group
  picker, sign-in, the data folder setup and the sync progress now share the
  app's calm design on SakaDesk's soft aurora, and each group's card, terms
  link and sign-in show that group's own colours.
  In a small window the terms now scroll instead of cutting off the Accept
  button, and the settings error message appears in your language and can be
  closed.
### Fixed
- **Videos no longer get stuck loading or freeze mid-play.** Opening many
  videos or voice messages no longer blocks the next ones from loading. Players
  now show a spinner while they wait for data, and a message with Retry if
  playback fails. Videos, voice messages and sync progress also keep loading
  during long sessions, instead of stalling for several minutes after the app
  has been open a while.
- **Voice and video durations always show** instead of sometimes reading
  0:00 / 0:00.
- **Opening Settings no longer slows the app down.** With a large blog
  archive, the blog cache size and backup counts took up to 20 seconds to
  appear and held up everything else meanwhile. The counts now appear in a
  few seconds and the rest of the app stays responsive.
- **Gallery photos no longer slide above the tabs** when you scroll.
- **Member photos are sharper** in chats, member lists and the blog member
  picker, and the selected member's ring stays clean.
- **The avatar no longer shows a dark outline** after you close a profile.
- **Favourites and member lists show placeholders while loading.** Video
  favourites show a clear loading shimmer, and video and voice favourites load
  as you scroll to them, so Favourites opens quickly.
- **Diagnostics opens immediately.** Disk usage fills in once it has been
  calculated, instead of the whole panel waiting for it on a large archive.
- **Voice messages fit their bubble neatly.** The player follows the bubble's
  corner, and the transcript joins the message without a step at the corners.
- **Tabs and blog filters start at the top.** Switching media gallery tabs or
  the blog feed's All / Favorite filter shows the new list from its start.
- **Links in messages are easier to read.** They are darker and underline when
  you point at them.
- **The chat menu button stays visible on hover** on coloured chat headers.
- **Cancel ends the whole first sync.** Pressing Cancel while SakaDesk
  downloads your groups for the first time used to leave the first sync
  hanging on the group it was running, so the other groups never started and
  your blog backup choice was never saved. It now stops the sync, closes the
  dialog, and still saves your blog backup choice.
- **Yodel's location warning uses Yodel's colours** instead of those of the
  screen behind it.
- **The member count in the search filter is translated** into your app
  language.
- **Jumping to an old date is quick.** Picking a day in the chat calendar now
  goes straight there instead of scrolling through every message in between,
  then glides the last stretch into place and gently highlights the message you
  land on. Jumps from search results, notifications and the media gallery glide
  in and highlight the message the same way.
- **The new-message count after a sync is now exact.** It used to include
  messages that were already saved.
- **A chat could stay frozen if its whole history was an exact multiple of 200
  messages** and the member had posted nothing new. Sync now handles this case
  and the chat updates again.
- **Favoriting a message during a sync could lose the messages that sync had
  just downloaded.** Both now take turns writing the file.
- **One failed refresh no longer hides every unread badge** in the sidebar.
- **An unread badge could never clear after a member withdrew a message**, and
  withdrawn messages still counted in chat totals and showed up in search.
  Badges and totals now leave them out, as the chat does, and search no longer
  adds them; the one-time full re-read of each chat after updating also removes
  the ones search already had.
- **Installing an update from inside the app could just close SakaDesk and do
  nothing**: the installer often gave up because SakaDesk hadn't finished
  closing yet, so nothing was installed and the app didn't reopen. It now waits
  for SakaDesk to close, installs the update, and reopens it.
- **After an update, the diagnostics report could list an outdated component
  version**, which made bug reports misleading. Leftover version information
  from the previous install is now removed when updating.
- **Some chats were missing many messages from members who were not in the room's
  current lineup** — for example the official 日向坂46 room's 2021–2022 member posts,
  earlier lineups of a single's live-event room, and announcements posted as the
  room itself. After updating, the first sync re-reads each chat once and adds
  them with their photos and videos. It goes slowly so the server doesn't refuse
  it, so it can take a while; if the server still asks it to slow down, the
  remaining chats are read on the next sync.
- **Retry on the blog screens works.** After a failed load, Retry now reloads
  the latest posts, or the post you were reading, instead of leaving an empty
  page or sending you back to the list.
- **The arrow keys no longer switch blog posts by accident.** Left and right
  now leave the post alone while you type in a text field, use a blog dialog
  or the photo viewer.
- **Closing one window no longer closes the one behind it.** Escape now
  closes only the top window (for example the date picker over the media
  gallery), and every window keeps the keyboard inside it and puts you back
  where you were when it closes.
- **Settings that fail to save now say so.** If a setting cannot be saved, a
  message appears under it and an error notice shows above the Settings
  window, instead of the change seeming to work.
- **Adding a group could start its first sync twice.** It now starts once.
- **Settings could reset after closing the window.** If the settings file
  could not be read at that moment, for example while antivirus was scanning
  it, saving the window size replaced it and the next launch started setup
  again. The file is now left untouched.
- **Read progress could be lost after a slow start.** If saved chat state
  failed to load when SakaDesk started, reading a message could overwrite
  earlier progress. SakaDesk now retries the load and does not save read
  progress until it has loaded.
## [0.3.4] - 2026-11-03

### Changed
- **Blog translations can now be shown or hidden**, like message translations:
  they appear automatically when translation finishes, click the "✓ translated"
  badge to hide or show them again, and they tuck away on their own once you
  scroll past the post or open another blog.

### Fixed
- **A brief server hiccup on one group could stop the entire sync**: if the
  member list for a single group failed to load, no group synced that round.
  That group is now skipped for the round and every other group syncs normally.
- **Some chats silently stopped receiving new messages after 0.3.2** — often
  official group channels and members whose chat history starts at your
  subscription date: every sync of that chat failed in the background, so it
  stayed frozen while your phone kept getting new messages. These chats update
  again, and messages you missed are filled in automatically on the next sync.
- **The member profile's subscription streak read awkwardly** (e.g.
  "購読して 128 日間！"): the line was assembled from separate fragments. Each
  language now has one natural sentence, such as 「メンバーシップ継続 128 日！」,
  「已連續訂閱 128 天！」 and "Subscribed for 128 days in a row!".
- **Members whose subscription you didn't renew stayed under "online"
  forever**: since 0.3.2, sync stopped checking lapsed subscriptions at all, so
  their last-known online status never changed. Sync now checks them again, and
  lapsed members move to the offline section on the next sync.
- **Copying a blog image to the clipboard showed "Failed to copy"** when
  the post's images were not backed up locally (blog full backup off, the
  default): the official image server blocks direct in-app downloads. Copy now
  fetches the image through the app, the same way Save already did.
- **Uninstalling offered to delete your saved credentials and settings with
  Yes preselected**, even during a silent (scripted) uninstall, where a stray
  Enter would wipe them. Silent uninstalls now never delete your data, and the
  question during a normal uninstall defaults to No.

## [0.3.3] - 2026-07-09

### Fixed
- **A first sync only kept each member's most recent 1000 messages**, silently
  leaving out older history even though it had already been downloaded. A fresh
  sync now saves a member's complete message history. Members you synced before
  this fix stay capped until you run a full re-sync (Force Resync), which now
  back-fills their older messages and media.
- **Blogs would not load at all**: the first blog sync crashed for every group,
  so no blog posts appeared. Blog syncing now completes and posts load normally.
- **A chat could show a wrong unread badge borrowed from another group**: when
  two groups in different services happened to share an internal id, one group's
  unread count could appear on the other. Unread badges are now tracked per
  conversation, so each shows its own count and clears to match your phone.

## [0.3.2] - 2026-07-08

### Fixed
- **Terminal/console windows popping up on their own, sometimes several times**:
  the app's silent login-refresh tried to drive a bundled headless browser that
  the installer does not ship, which kicked off a runtime Chromium download in a
  visible console window (and retried on network hiccups). The refresh now reuses
  your already-installed Chrome/Edge — the same browser used to log in — so
  nothing is downloaded, and the packaged app now keeps any child process
  windowless as a safety net.
- **Your selected groups, favorites, layout and open chats could reset to
  defaults on launch**: a start-up timing issue occasionally saved a blank
  default state over your real one. Your saved settings are now loaded before
  anything can overwrite them, and the app reliably reopens on your last group.
- **A settings change made right before closing the app could be lost**: pending
  changes (a toggle you just flipped, the conversation you last read, scroll
  position) are now flushed when the window closes instead of being dropped.
- **Favoriting a message could silently undo itself**: when the server rejected a
  favorite the star stayed lit until the next reload; a failed favorite now
  reverts immediately and tells you it didn't save. Favorites also update the
  correct message when two groups share a message number.
- **Date search and the calendar could jump to or highlight the wrong day** for
  messages around midnight, because dates were bucketed in UTC while messages
  display in your local time. Both now use local dates consistently.
- **Sync could not be stopped once it was verifying files, and the sync window
  could get stuck spinning** on an error. Cancelling now stops the verify pass
  too, the window is always dismissable, and sync errors show a readable message.
- **Search could silently drop results or show wrong totals** when two groups
  happened to share a message number; results are now counted per group.
- **The app could freeze while browsing a large library**: heavy disk, database
  and credential reads now run off the main request path, so the UI and media
  playback stay responsive.
- **Launching a second copy (or reopening quickly after closing) showed a
  "Server failed to start" error**: a real single-instance check now focuses the
  running window instead, and the start-up wait was lengthened to cover a normal
  close-then-reopen. A minimized-then-closed window no longer restores off-screen.
- **An interrupted in-place update could roll back after locking program files**:
  the updater now shuts the app's background worker down before exiting, and the
  uninstaller only removes the app's own files instead of the whole chosen folder.

- **Translation "API key not set" even when it looked configured**: the AI
  settings panel could show the key as "saved securely" while it was actually
  missing from the OS credential store, so translation failed with a confusing
  message. The panel now warns clearly when a provider is set but no key is
  stored, and the status self-heals after a failed translation.
- **Window grew on every restart** at non-100% display scaling; window geometry
  is now correct at any DPI scale and across multiple monitors.
- **Manual "Check for updates"** now forces a live check instead of possibly
  reporting a stale "up to date".
- **In-place updates** now close a running app cleanly (WM_CLOSE) instead of
  risking a rolled-back install.
- **Blog metadata sync** no longer fails with an "access denied" error when
  another process briefly holds the blog index (antivirus/search indexer); the
  write is retried.

### Security
- **The built-in bug report could put which group/member you message into the
  public issue it opens.** Bug reports and copied diagnostics are now scrubbed —
  the specific member and any custom data-folder path are removed before anything
  leaves the app.
- Hardened the local API against path traversal, DNS-rebinding, and
  cross-origin/CSRF (SEC-1, SEC-2, API-I2).
- Self-update downloads are restricted to HTTPS GitHub hosts (SEC-4).
- Secrets are scrubbed from diagnostics and issue-report output (SEC-5).
- Blog image proxy no longer follows redirects and is size-capped (API-I3).
- Credential store no longer silently falls back to a plaintext keyring
  (opt-in only; SEC-3).
- Fixed a sync-cancellation data-corruption risk (SVC-C1) plus assorted
  sync/blog/search correctness fixes.

## [0.3.1] - 2026-07-04

### Added
- **Verify & Fix media** (Settings → Sync): scans downloaded messages and
  re-downloads any missing images/videos, per service.
- **Deep re-verify** (Settings → Sync): an on-demand full re-sync that re-checks
  every member's entire timeline from scratch and re-downloads anything missing
  (files already saved are skipped). Catches gaps the media-only check cannot —
  including entirely-missing messages. Behind a confirm, as it is slower and makes
  many API requests.
- A clear warning when logging into **Yodel** from outside Japan — Yodel's web
  service is Japan-only, so a login from another region can't reach its servers.
  The app now detects this before login and explains how to proceed (connect from
  Japan and try again) instead of failing silently.

### Fixed
- Interrupted syncs no longer permanently skip message media — the sync cursor is
  held behind any message whose media has not been confirmed on disk.
- API key and login are no longer dropped on app update or reinstall. Credentials
  are now isolated per entry in the OS keyring (via pysaka 0.4.2), so a routine
  session refresh can no longer overwrite a stored translation/AI API key.
- Translation no longer fails with `no_model` when the saved config omits a model;
  it falls back to the default and self-heals the stored value.
- The log directory now honors `SAKADESK_DATA_DIR`.
- **Verify & Fix media no longer overstates completeness.** Media messages whose
  media has no downloadable source (e.g. expired-media stubs) are now reported as
  unresolved instead of being silently counted as present, and the "all present"
  message is scoped to downloaded messages — so the check never claims complete
  while media is unaccounted for.
- Uninstall now removes the correct saved credentials and auth data (it targeted
  stale `pyzaka`/`zakadesk` names before, missing the current `pysaka` entries).
- **Blog backup now resumes safely after an interruption.** Blog content and
  images are written atomically, and a blog left partial by a crash/interruption
  is detected and re-downloaded instead of being skipped as "done".
- The sync progress window no longer looks stuck after finishing: the
  "downloading media… do not close" warning now clears on completion, and a Done
  button lets you dismiss it (it also auto-closes).
- Settings → AI now opens without waiting on the OS keyring. The key-status read
  behind `/api/translation/config` is cached in memory (warmed at startup,
  invalidated on save/clear) instead of being re-read on every open; a brief
  loading indicator covers the first open after launch.

### Changed
- Starting **Verify & Fix media** now closes the settings panel so the validation
  progress and result are in focus.
- The **Deep re-verify** confirmation now uses an in-app styled dialog matching the
  rest of the UI, instead of the browser-native `window.confirm` popup.
- After **Verify & Fix media**, the progress window stays open and shows the
  results — any media with no available source is listed by **member and date**
  (with a Done button to dismiss) instead of the panel auto-closing.
- **Withdrawn (member-canceled) posts** are now hidden from the message list and
  no longer counted as missing media. Their status is recorded in the synced data
  on disk but not shown. Existing messages pick this up after a re-sync (which
  backfills the message `state`); Deep re-verify does a full backfill.
- **Translation** is no longer marked "Experimental".
- The translation **target language** in Settings → AI now appears immediately
  (from the saved value) instead of waiting for the config to load.
- **Blog backup** wording and progress are clearer: it's called "backup" (not
  "cache"), the size shows a "Calculating backup size…" indicator, and an active
  backup shows "Backing up blogs… X of Y".

## [0.3.0] - 2026-07-01

### Added
- **AI transcription** — on-demand Gemini transcription of voice/video messages
  with timeline-synced segments and click-to-seek subtitles; structured-output
  timestamps, File API for large audio, and safety-block handling.
- **AI translation** — immersive blog translation with in-place DOM injection,
  per-message translation, a unified translate button with error state, and
  provider/model settings.
- **Mobile auth mode** — per-service auth mode (web/mobile) with a redesigned
  account tab, manual refresh_token entry, an Android request profile, and a
  login-time mode choice; rows scoped to connected services.
- **Two-way unread sync (opt-in)** — opening a room in SakaDesk can clear its
  unread on the official app (Windows → phone), and the unread badge reflects
  reads made on the phone (phone → Windows).
- **Blog photo gallery ("Album")** — photo gallery modal with post dates, wired
  into the member timeline, with jump-to-message from a photo.
- **Clipboard copy** — Ctrl+C to copy media to the clipboard in the media viewer.
- **Media gallery** — jump-to-message from photo/video/voice detail via clickable
  timestamps, per-row transcript previews, source labels with a jump action.
- **Settings redesign** — left-sidebar tabs, a shared "AI Provider" block for
  transcription + translation, "Reset to defaults", and "Clear API key".
- Rerun buttons for transcription and translation; diagnostics bundle filename;
  release CI infrastructure.

### Changed
- Unified the Voice, Video, and Photo players into shared components that own
  their transcription across bubble, gallery, and fullscreen contexts.
- Gemini model list centralized and updated to GA IDs (gemini-3.1); stale model
  names auto-reset to default on config load.
- Message/media panels auto-expand and auto-collapse based on visibility.
- Desktop window geometry migrated into settings.json; no longer shrinks on restart.
- Requires **pysaka >= 0.4.0** (mobile auth mode, two-way unread sync, data-loss fixes).

### Fixed
- Numerous transcription/subtitle-sync, auto-expand/collapse, and fullscreen
  control fixes across the media players.
- Auth: reconnection cooldown stops the login dialog re-triggering; disconnect
  state preserved across auth refresh; rotated refresh_token persisted.
- Translation no longer caches truncated (`MAX_TOKENS`/`RECITATION`) output as a
  success; fullscreen photo viewer recovers after a broken image; transcript
  auto-scroll no longer skips every other active segment.
- Many i18n corrections across the 5 locales.

### Removed
- Local Whisper transcription model (transcription is now Gemini-only).

## [0.2.4] - 2026-03-29

### Added
- **Upgrade system redesign** — replaced fragile batch script with direct Inno Setup `/SILENT` invocation; two-stage upgrade icon in service rail replaces top gradient banner
- SHA-256 verification for downloaded installers (mandatory, refuses unverified files)
- Download integrity checks: file size validation + 500 MB download cap
- `auto_download_updates` setting with toggle in Settings (default: OFF, opt-in)
- "Check for Updates" button in Settings for manual version checks
- Auto-relaunch after silent install via Inno Setup `[Run]` section
- Graceful app shutdown before installer launch
- Shorter 5-minute cache TTL for failed GitHub release checks (vs 1 hour for success)
- Download button click tracking via Vercel Analytics custom events on website
- i18n keys for upgrade UI in all 5 locales (EN, JA, ZH-CN, ZH-TW, YUE)

### Changed
- Upgrade icon uses ArrowUpCircle (ready) and Loader2 (launching) icons
- Voice player no longer auto-repeats by default
- Video player: loop, speed, and download controls moved into three-dot menu
- Website screenshots replaced with high-res WebP format

### Security
- Installer filename sanitized to prevent path traversal via crafted API response
- `release_url` validated against `github.com` origin before opening
- Auto-download defaults to OFF — requires explicit user opt-in for silent downloads

### Removed
- `UpdateBanner.tsx` — replaced by `UpgradeIcon` in service rail
- Batch script upgrade mechanism (`generate_upgrade_script`, `launch_upgrade`)
- `/upgrade/launch` API endpoint — replaced by `/upgrade/install`

## [0.2.3] - 2026-03-22

### Added
- Landing page website with i18n support (EN, JA, ZH-TW, ZH-CN) and screenshot carousel — Astro static site with Tailwind CSS for Vercel deployment
- GPL-3.0 license

## [0.2.2] - 2026-03-22

### Fixed
- **Critical:** Sync cascade causing 164 syncs per session instead of 4 — React effect dependency chain created feedback loop where sync completion triggered immediate re-sync
- **Critical:** Blog backup timeout storm — all blog downloads fired concurrently, overwhelming the connection pool and causing mass TimeoutError
- Settings file contention on Windows — `os.replace()` fails when antivirus locks the file; added retry with backoff
- User nickname (%%%) placeholder visible on app load — nicknames now cached during sync and returned in settings API response
- Adaptive sync always hitting 5-minute floor due to `sync_interval_minutes` default of 1

### Changed
- Adaptive sync base interval hardcoded to 10 minutes, decoupled from user setting (which only applies to fixed-interval mode)
- Time-of-day multipliers rebuilt from 13,132 actual Hinatazaka46 messages — peak hours (20:00 JST) now sync every ~5 min, dead hours (01:00-06:00) every ~30 min
- Blog download concurrency limited to 5 concurrent blogs (was unbounded), image semaphore reduced from 50 to 20
- Memoized `connectedServices` in AuthContext to prevent unnecessary effect re-runs
- Nickname refresh runs once per app session (first sync), subsequent syncs use cache
- Removed unused activity multiplier from adaptive sync (was dead code)

## [0.2.1] - 2026-03-21

### Changed
- **Breaking:** Rebranded from HakoDesk to SakaDesk across the entire codebase
- Renamed SDK dependency from pyhako to pysaka (requires pysaka >= 0.3.0)
- Externalized remaining hardcoded Japanese strings to i18n locale files
- Replaced ToS acknowledgement list with official service excerpts
- Moved BlogBackupManager to dedicated background thread
- Centralized settings defaults in settings_store

### Added
- Pre-commit hooks (ruff, mypy, tsc, eslint) for development quality gates
- Comprehensive backend test suites (23 new modules, 80%+ coverage)
- Frontend test suites for SyncModal, useSettings, syncFormatters, downloads
- Atomic file writes for blog index and sync metadata (prevents corruption)
- Batch operations: check_new_messages, group timeline fetch, blog metadata
- ProcessPoolExecutor for GIL-free search index builds
- Timestamp-based sync cursor (replaces message-ID cursor)
- Log rotation with separate error.log
- Video player loop toggle button (replaces auto-loop)
- Blog recent posts cache with Zustand persistence

### Fixed
- Concurrent image downloads bounded to prevent timeout
- React effect dependency stability with useRef in BlogsFeature and useSettings
- Conditional React hook calls in PhotoDetailModal
- TypeScript compilation errors in BlogsFeature
- mypy type errors in search_service, sync_service, and diagnostics
- Flaky BlogBackupManager tests replaced time.sleep with threading.Event
- Frontend snapshot tests compatible with pre-commit whitespace hooks
- Prevent concurrent browser login launches
- freeze_support() added to prevent duplicate app on Windows
- Search indexing moved to background to unblock sync Phase 3

### Security
- CI hardened with explicit permissions per job
- Version validation in Inno Setup to prevent command injection
- Coverage threshold enforced at 80% for backend

## [0.2.0] - 2026-03-16

### Added
- Multi-service architecture — sync and view multiple services simultaneously
- First-launch onboarding flow with login carousel and sequential sync
- Per-service inline sync progress view (replaces empty-state confusion)
- Global fuzzy search across messages and blogs with keyword highlighting
- Blog feature with full-text search, member filtering, and media gallery
- Blog full backup with parallel downloading and background processing
- Internationalization (i18n) with 5 languages: English, Japanese, Traditional Chinese, Simplified Chinese, Cantonese
- Service-themed UI with per-group color schemes and ambient backgrounds
- Yodel service support
- Member favorites and custom service/feature ordering via drag-and-drop
- Adaptive sync with smart timing based on posting patterns
- Desktop notification support (hidden until stable)
- In-app update checker with version comparison
- DPI-aware window geometry save/restore
- Search index with reader-writer executor split for concurrent access
- Settings UI with blog backup status, sync interval, and output folder picker
- About dialog with diagnostics and issue reporting
- Session expiration detection with automatic re-login prompt
- Comprehensive test suites: backend (83 tests), frontend (Vitest), E2E (Playwright)

### Changed
- Auth/sync flow follows pysaka CLI pattern with TokenManager integration
- FastAPI lifecycle migrated from deprecated `on_event` to `lifespan` context manager
- Folder picker uses async executor instead of blocking thread.join
- PriorityPool replaced with per-operation TCPConnector limits
- Structured logging uses keyword args instead of f-strings throughout
- Requires pysaka >= 0.2.0

### Fixed
- XSS vulnerability in search result snippets — now sanitized with DOMPurify
- Internal exception details no longer leaked in HTTP 500 responses
- `metadata_file` initialized in SyncService `__init__` with runtime guard
- `member_ids` query parameter validates integer conversion (400 vs 500)
- DPI scaling drift on window geometry save/restore
- Sync works immediately after re-login (no restart required)
- Session expiration properly redirects to login

### Security
- Search snippets sanitized with DOMPurify (ALLOWED_TAGS: mark only)
- HTTP 500 responses return generic message, full errors logged server-side
- Structured logging prevents credential leakage via f-strings

## [0.1.0] - 2026-01-11

### Added
- Initial SakaDesk GUI application
- Cross-platform support (Windows production, Linux/Mac development)
- Secure credential storage via Windows Credential Manager
- Browser-based OAuth authentication flow
- Real-time sync progress tracking with ETA
- Message viewing with media support (images, videos, voice)
- Audio playback with progress bar
- Scroll position restoration per chat
- Media dimension pre-calculation for smooth loading
- Chat list with member avatars and unread indicators
- Diagnostics endpoint for debugging
- Cross-platform build verification scripts
- GitHub Actions CI/CD pipeline

### Security
- API hardened against common vulnerabilities
- Rate limiting on sensitive endpoints
- Input validation and sanitization

[Unreleased]: https://github.com/xebjhm/SakaDesk/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/xebjhm/SakaDesk/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/xebjhm/SakaDesk/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/xebjhm/SakaDesk/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/xebjhm/SakaDesk/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/xebjhm/SakaDesk/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/xebjhm/SakaDesk/compare/v0.3.1...v0.3.2
[0.2.4]: https://github.com/xebjhm/SakaDesk/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/xebjhm/SakaDesk/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/xebjhm/SakaDesk/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/xebjhm/SakaDesk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xebjhm/SakaDesk/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xebjhm/SakaDesk/releases/tag/v0.1.0
