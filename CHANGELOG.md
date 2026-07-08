# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0](https://github.com/xebjhm/SakaDesk/compare/SakaDesk-v0.2.4...SakaDesk-v0.3.0) (2026-07-08)


### Added

* add blog backup status to settings and search UI ([8244833](https://github.com/xebjhm/SakaDesk/commit/824483350e6109175d210c54c25eac0b658497d3))
* add blog cache clean button in settings (Task 9) ([de6b33e](https://github.com/xebjhm/SakaDesk/commit/de6b33eba8f89848b9b26ee13e5e93a2eb02ad48))
* add blog recent posts cache with Zustand persistence ([312f533](https://github.com/xebjhm/SakaDesk/commit/312f5336c26c3df078600000b8c44d71abb9c400))
* add custom VideoPlayer component with amplified volume ([b86b335](https://github.com/xebjhm/SakaDesk/commit/b86b335f141174d77eda1fe876993c54c9050ce4))
* add downloadMedia utility for blob-based file saving ([cbe9c34](https://github.com/xebjhm/SakaDesk/commit/cbe9c34f65ea36e44123824ac5109e931411b1b5))
* add full index build triggers with primary/failsafe design ([27b5121](https://github.com/xebjhm/SakaDesk/commit/27b5121b5dd22f0386009742f50ef1715b1a69ef))
* add global fuzzy search with Japanese text normalization (Cmd+K) ([ec17228](https://github.com/xebjhm/SakaDesk/commit/ec172289b5d42e553593705ab60309f76fb138d4))
* add keyboard nav and VideoPlayer to media gallery ([0a6b050](https://github.com/xebjhm/SakaDesk/commit/0a6b0506206167efa5f046fe3d82037382e01025))
* add useAmplifiedVolume hook for Web Audio API volume control ([f735f87](https://github.com/xebjhm/SakaDesk/commit/f735f8755cdda8e919d9514e4dfea601c99ab114))
* add useModalClose hook for Escape and backdrop-click-to-close ([778ee65](https://github.com/xebjhm/SakaDesk/commit/778ee6523714a483f053b128860cc2801a39d219))
* **ai:** coded translation/transcription errors for localizable, actionable UI ([dc8522b](https://github.com/xebjhm/SakaDesk/commit/dc8522bc137f7420499ebe35f10dc6ee7eec3aee))
* **ai:** show localized, actionable AI error messages (i18n) ([b51cb72](https://github.com/xebjhm/SakaDesk/commit/b51cb72ff08f07d93c297fa0419e05c56ff41ea0))
* **api:** add File API for large audio, handle safety blocks ([ebee42f](https://github.com/xebjhm/SakaDesk/commit/ebee42f9e574f38bd48ec6f9256210d789061015))
* **api:** add POST /api/sync/verify endpoint ([6a1d998](https://github.com/xebjhm/SakaDesk/commit/6a1d9989d23d7ebb1345fa63c6cfa83bbfbe1759))
* **app-state:** clear-translations endpoint ([9eed404](https://github.com/xebjhm/SakaDesk/commit/9eed40455614237b7e97e6e6e93aba5d03028b87))
* **app-state:** get-all conversations endpoint + eager-loaded sync conversation cache ([cd4c75d](https://github.com/xebjhm/SakaDesk/commit/cd4c75d27316628839dc1df65dbf7bf7899b313d))
* **app-state:** HTTP endpoints for prefs/conversation/translations/migrate ([0af55cd](https://github.com/xebjhm/SakaDesk/commit/0af55cdbe7c0df1a8bd11a1bf805762fcd842be5))
* **app-state:** SQLite store for prefs/conversation/translation-cache ([e4c56e5](https://github.com/xebjhm/SakaDesk/commit/e4c56e5029ca17ba567d7e12acd0fa7bea53b3e2))
* **auth:** handle RefreshFailedError and use sync_metadata for is_active ([763d1f2](https://github.com/xebjhm/SakaDesk/commit/763d1f22701184ca61dd8156bd775c5f2f14edae))
* **auth:** manual refresh-token entry for mobile mode ([f25db8c](https://github.com/xebjhm/SakaDesk/commit/f25db8c715831902872ded5f58f8e0bfb4200623))
* **auth:** mobile mode emits android request profile via platform param ([28a1723](https://github.com/xebjhm/SakaDesk/commit/28a1723a35ed78d89269c96fdff1b88e248c5893))
* **auth:** scope mode rows to connected services + login-time mode choice ([e790382](https://github.com/xebjhm/SakaDesk/commit/e79038218cf08d24b6c0e64a28216a667b7ad2d7))
* **auth:** warn on Yodel login from outside Japan (JP-only web service) ([3c9af71](https://github.com/xebjhm/SakaDesk/commit/3c9af7193dec770cbf6fa0f06c324705f38f1eca))
* **auth:** wire mobile auth mode — call sites, settings UI, i18n ([b00d170](https://github.com/xebjhm/SakaDesk/commit/b00d1703403ff8aa2f3cd2500667ab01a41e3b1c))
* **backend:** add search filters, read state tracking, and group chat detection ([87269c3](https://github.com/xebjhm/SakaDesk/commit/87269c3bc4920103614735deae39c1f490739a5f))
* blog backup manager with cancel support and local image serving ([f17a031](https://github.com/xebjhm/SakaDesk/commit/f17a031bc2bb025edc7cfaee228b9a57e3f381eb))
* blog feed first-sync spinner and i18n text updates ([4205bc7](https://github.com/xebjhm/SakaDesk/commit/4205bc7c77c6366e4b6da56882491fa8c7d53558))
* blog photo viewer with click-to-open images ([f000ae4](https://github.com/xebjhm/SakaDesk/commit/f000ae4fcec2a7edbaebf15aced8c858c5b85a65))
* blog-backup fail-safe + UI clarity; translation stable + instant target lang ([8cc7a41](https://github.com/xebjhm/SakaDesk/commit/8cc7a415c08975ab6237ac06615f406a7ed01a62))
* **blogs:** add auto-sync on visit with race condition handling ([4e10b82](https://github.com/xebjhm/SakaDesk/commit/4e10b82d8a4c08ce3a88ab82f67bc740d48e749f))
* **blogs:** add BlogPhotoGalleryModal component ([b77d104](https://github.com/xebjhm/SakaDesk/commit/b77d10414efdee6b1ca9c41843c413e6f445dc0d))
* **blogs:** add photo gallery button to MemberTimelineModal ([4a7156f](https://github.com/xebjhm/SakaDesk/commit/4a7156fcdf02ed1c085439770573654d8f9d76e2))
* **blogs:** add post date to photo viewer and rename to Album ([21d56ab](https://github.com/xebjhm/SakaDesk/commit/21d56ab037fe8291e2a02a6b1b5860081bc5ad28))
* **blogs:** wire up BlogPhotoGalleryModal in BlogsFeature ([28dcdaf](https://github.com/xebjhm/SakaDesk/commit/28dcdaf64857f96d5d46fbc2f90f1c3729de4aff))
* **build:** include version in Windows installer filename ([165ddc6](https://github.com/xebjhm/SakaDesk/commit/165ddc6993ecd23abe4642fa12ab2bea5f0d2f98))
* **calendar:** add dates mode for direct DateCount[] input ([e4fda64](https://github.com/xebjhm/SakaDesk/commit/e4fda64a532da9902c23f4516ae38d6f308e3006))
* centralize version management and fix blog search ([a7b7e04](https://github.com/xebjhm/SakaDesk/commit/a7b7e042b139fe0c34a67f5193448b3a8b6dab2c))
* **ci:** add release infrastructure improvements ([92ad1e0](https://github.com/xebjhm/SakaDesk/commit/92ad1e0df996bca4d3a18f62a0de35854b094777))
* **clipboard:** add Ctrl+C media copy to clipboard in media viewer ([aedc840](https://github.com/xebjhm/SakaDesk/commit/aedc8405ea0774e2be7a18e625336060d6ae95e5))
* **content:** hide withdrawn (canceled) messages from the UI ([7fcdb72](https://github.com/xebjhm/SakaDesk/commit/7fcdb72cf6c5bee006def73e4bce080c1f5cc09a))
* **desktop:** unify first-open window size across DPI scales ([b651c40](https://github.com/xebjhm/SakaDesk/commit/b651c408e0c11c1c4a555ceb39808038805f1714))
* **diagnostics:** add expandable per-service disk usage breakdown ([e107abc](https://github.com/xebjhm/SakaDesk/commit/e107abc0e637137c364a6f8cdc55dab7045ec091))
* **diagnostics:** show current frontend bundle filename ([ca95ad5](https://github.com/xebjhm/SakaDesk/commit/ca95ad51a7a8a717f89f4359af0fb4999419fadd))
* disambiguate official accounts in search filter dropdown ([d5bebb4](https://github.com/xebjhm/SakaDesk/commit/d5bebb4e95375e6cea17affc077fcf78835a724b))
* dynamic search placeholder based on content type filter ([e8cd1dc](https://github.com/xebjhm/SakaDesk/commit/e8cd1dc40b7308d3f3c180a53a501794fac2da75))
* fresh service login prompt and service-matched LoginModal header ([5059a5d](https://github.com/xebjhm/SakaDesk/commit/5059a5dfb00f0eb71ac8072dfeafd305ae40467f))
* **frontend:** activate theme CSS variables and fix ESLint errors ([7f8ce12](https://github.com/xebjhm/SakaDesk/commit/7f8ce1274b1a57db9019d4a14088ccb50488eddd))
* **frontend:** add feature request button in settings menu ([c3409c1](https://github.com/xebjhm/SakaDesk/commit/c3409c109e249424c48fa9f9325aa2de591e8ced))
* **frontend:** add graduated member section with is_graduated flag ([9818eca](https://github.com/xebjhm/SakaDesk/commit/9818eca7c069d72d564c7772c014a9f26ff32e35))
* **frontend:** add search filter UI, navigation fixes, and read state migration ([b108dbb](https://github.com/xebjhm/SakaDesk/commit/b108dbb882c06211e8e45735196d48d13bcf941e))
* **frontend:** add semantic color tokens and CSS variable system ([671bffd](https://github.com/xebjhm/SakaDesk/commit/671bffd45a522b894adde3024d3feac2d2f3fc37))
* **frontend:** add ToS acknowledgment dialog on first launch ([e57a733](https://github.com/xebjhm/SakaDesk/commit/e57a73358a3ecd6707181d2ce8eba27c89948a6c))
* **frontend:** add Verify & Fix media button and summary ([2a5b95f](https://github.com/xebjhm/SakaDesk/commit/2a5b95f29824b95e5f8195676730534c1f246a45))
* **frontend:** add verifyAndFix hook and i18n strings ([33f32a3](https://github.com/xebjhm/SakaDesk/commit/33f32a374eddafc96658631b6a1d8126eadfdbdd))
* **frontend:** add Yodel service theme, config, and service rail support ([aefd18a](https://github.com/xebjhm/SakaDesk/commit/aefd18a63b72abda22a3b30a9bb33ba65931e84a))
* **frontend:** setup i18n infrastructure with react-i18next ([74de0f4](https://github.com/xebjhm/SakaDesk/commit/74de0f4817641c0b1d12f9e38fee096390193ab3))
* global service ordering with drag-and-drop in ServiceRail ([fac4fd3](https://github.com/xebjhm/SakaDesk/commit/fac4fd3181d4d16eef0ba8fe592f08119774982f))
* **i18n:** add blog photo gallery translations ([b206f6c](https://github.com/xebjhm/SakaDesk/commit/b206f6c07573eb9c98f139b2a28fc146890d6701))
* **i18n:** complete localization for blogs and messages features ([ed8dcc6](https://github.com/xebjhm/SakaDesk/commit/ed8dcc6ab0a3265bb7ab439ed9a46c1c4f49fda6))
* **i18n:** extract comprehensive UI text to locale files ([c611947](https://github.com/xebjhm/SakaDesk/commit/c611947cc087771a9ca37f3ddab299939e53f6b5))
* **i18n:** integrate translations into all UI components ([f9c49e4](https://github.com/xebjhm/SakaDesk/commit/f9c49e4e9a93f3732353f2f49602dc3abcc65bac))
* **i18n:** localize sync phase names ([9aaaf23](https://github.com/xebjhm/SakaDesk/commit/9aaaf236096d2b18105bba799c02ea27f88e2aa7))
* installer uninstall i18n + data remains notification ([2c5bfe8](https://github.com/xebjhm/SakaDesk/commit/2c5bfe8d8692766117ad159e22c2f42f26177aa1))
* integrate MediaViewerModal and VideoPlayer in chat room ([22f6a59](https://github.com/xebjhm/SakaDesk/commit/22f6a59fc22fc8b2b032559c4559a91c003f8850))
* **lock:** OS-level crash-safe data-dir write lock ([5eb3712](https://github.com/xebjhm/SakaDesk/commit/5eb3712c04977e7956cbbe3bb23faef76f8fc5b9))
* **logging:** add phase timing and per-group diagnostics to sync ([7e20a33](https://github.com/xebjhm/SakaDesk/commit/7e20a335a4bdcd00aa45b78be224a92e569b8f6c))
* **logging:** add shutdown diagnostics to search service ([391483b](https://github.com/xebjhm/SakaDesk/commit/391483b6eeceefb4503999b61955a01c73b553d9))
* **logging:** add stage timing to blog full backup ([2bebbd3](https://github.com/xebjhm/SakaDesk/commit/2bebbd3bc70e3d14a729456da65766a828a2ec05))
* **media-gallery:** jump-to-message from photo/video/voice detail ([30efe12](https://github.com/xebjhm/SakaDesk/commit/30efe128ba4f27b3557016e044c5d8ff92b75520))
* **media:** add golden finger download easter egg ([c468006](https://github.com/xebjhm/SakaDesk/commit/c468006f59b652690c013bb4ddc80b94c0b0be4b))
* **media:** add source label with jump action to MediaViewerModal ([bd57f57](https://github.com/xebjhm/SakaDesk/commit/bd57f5719b75efa9dfcc2ec925a5b99159800533))
* non-blocking get_members during build and refetch on completion ([8247fdc](https://github.com/xebjhm/SakaDesk/commit/8247fdcd30928447b40a4e673fd869044c2763d1))
* onboarding login flow, sequential sync & migration cleanup ([57876fe](https://github.com/xebjhm/SakaDesk/commit/57876fec341aa6e16b563cbd05c7cfaff5de36e2))
* persist window size/position and use HTTP health check ([ad1d26c](https://github.com/xebjhm/SakaDesk/commit/ad1d26c4c04c5ac60bdff9cd68379955bbf856dd))
* **persist:** backend-backed persisted layer + prefs hydration ([04845ef](https://github.com/xebjhm/SakaDesk/commit/04845ef591cd4be4a83b1ab887ef3d0e388fe95b))
* **persist:** one-time localStorage -&gt; backend migration ([be71718](https://github.com/xebjhm/SakaDesk/commit/be717185bfa1c65acd980bf6ab9e6b83ec70a8d3))
* **progress:** add structured result field for verify summary ([bc63727](https://github.com/xebjhm/SakaDesk/commit/bc6372761a0c92654758681fe0f5e0b42e4d681e))
* redesign first-launch flow with login carousel and sequential sync ([9a5e7c6](https://github.com/xebjhm/SakaDesk/commit/9a5e7c6952bbe48d2dda28af5fdd680c45eae128))
* **search:** add blog navigation from search and cache notice ([2d9875c](https://github.com/xebjhm/SakaDesk/commit/2d9875c98d99e6375c1bce00bc0e62e2808146ae))
* **search:** add blog schema, HTML stripping, and blog indexing ([1f993f7](https://github.com/xebjhm/SakaDesk/commit/1f993f711c9e3dc4e812e39a9219c23759dabf5c))
* **search:** add blog search queries with UNION and content_type filter ([b6fd69f](https://github.com/xebjhm/SakaDesk/commit/b6fd69f53d6aeff2c491823c34163d53375acfc3))
* **search:** add blog search queries with UNION and content_type filter ([202b74f](https://github.com/xebjhm/SakaDesk/commit/202b74f2336dfa0ed4901404ac70d9467c893137))
* **search:** add blog search UI - types, filter, rendering, i18n ([a5fcf91](https://github.com/xebjhm/SakaDesk/commit/a5fcf917e81ff37c565a6a7b95fb103f9dfab1e3))
* **search:** add content_type param to search API endpoint ([1e88786](https://github.com/xebjhm/SakaDesk/commit/1e8878688b2eddf69ea974d5128f1f46314aad1c))
* **search:** add incremental blog indexing after sync ([2e63cc8](https://github.com/xebjhm/SakaDesk/commit/2e63cc8121f76dc9977e9a8160632b3bb18de16a))
* **search:** include blog-only members in search member filter ([9e57d8e](https://github.com/xebjhm/SakaDesk/commit/9e57d8ec5fb2f52f4e87939b6432a1ec0b8cbcc4))
* **search:** replace %%% placeholder with user nickname in search results ([f8685f9](https://github.com/xebjhm/SakaDesk/commit/f8685f9359032e994ae419e3e957061585c819d4))
* **search:** use blue highlights for reading-based matches in BlogReader ([c026a84](https://github.com/xebjhm/SakaDesk/commit/c026a847c517aed1c0a104be8baf7a6d770bc94f))
* **settings:** add auto-download toggle and check-for-updates button ([5b19df0](https://github.com/xebjhm/SakaDesk/commit/5b19df094d3a14dd03d91da89dd4c771cfd5254c))
* **settings:** add Reset to defaults + Clear API key ([c94c154](https://github.com/xebjhm/SakaDesk/commit/c94c154a478c9bcfaa91d4e2e2c2748d373ac697))
* **settings:** move blog backup from per-service to global setting ([d62feb8](https://github.com/xebjhm/SakaDesk/commit/d62feb80ebf6fee4fc100a5b308fdbdf47932805))
* **settings:** reorganize panel into left sidebar tabs ([79324e8](https://github.com/xebjhm/SakaDesk/commit/79324e89f76304bdd334f9a254ebed7178b077fb))
* **settings:** show current sync state summary above sync mode controls ([6ea8939](https://github.com/xebjhm/SakaDesk/commit/6ea89398fa81bab4807181a6aa0ba3f6f38f2261))
* **settings:** show per-service blog backup for all services and unify sync mode controls ([413ea8c](https://github.com/xebjhm/SakaDesk/commit/413ea8c11410ea4dc6d62c0ca760015ac3ffbf24))
* **shell:** show login popup when switching to disconnected service ([44279f2](https://github.com/xebjhm/SakaDesk/commit/44279f26bdabfc147d76ac80be1ac7b1efeb3556))
* **shutdown:** acquire write lock; quiesce+drain writers before release ([83f5b27](https://github.com/xebjhm/SakaDesk/commit/83f5b2744238f879036669d8dfeb1b313604f6a1))
* sort search filter members by blog member ID within each service ([5b13801](https://github.com/xebjhm/SakaDesk/commit/5b138013cfd7e5f05e237317522b33b5e8b00124))
* split search index into reader-writer executors ([4c544f6](https://github.com/xebjhm/SakaDesk/commit/4c544f646f8a9216b0fba8437244b5563f6f116e))
* **sync:** add Deep re-verify (full re-sync) action ([a7589f9](https://github.com/xebjhm/SakaDesk/commit/a7589f9f66bace77735fdf2384f44f07568e3405))
* **sync:** add last synced indicator and manual sync button to MemberList footer ([da4f6b8](https://github.com/xebjhm/SakaDesk/commit/da4f6b82badd86c0c7bda55d398239cf74c44e3c))
* **sync:** add opt-in two-way unread sync to mobile ([54b01ab](https://github.com/xebjhm/SakaDesk/commit/54b01ab3d3184123ccbd41c1fbdeb034c843953e))
* **sync:** add per-service inline sync view with i18n ([2bf6283](https://github.com/xebjhm/SakaDesk/commit/2bf6283fdb05b558b06f24c58fcd70cbeefcab58))
* **sync:** add verify_and_fix_media backfill orchestrator ([4092195](https://github.com/xebjhm/SakaDesk/commit/4092195526d511f29b5ed0d9a8533bb16d608355))
* **sync:** reflect phone reads in the unread badge (phone -&gt; Windows) ([ffb7789](https://github.com/xebjhm/SakaDesk/commit/ffb778940f9425ab767f40359c05148be78498de))
* **sync:** surface phone read-sync failures in Settings ([#4](https://github.com/xebjhm/SakaDesk/issues/4)) ([ddc2778](https://github.com/xebjhm/SakaDesk/commit/ddc27789edc9b6e64ba510f433aa72ff589e2c5a))
* **sync:** update check_new_messages to use timestamp cursor ([60ec442](https://github.com/xebjhm/SakaDesk/commit/60ec442f627232cc9d2d578ebe0e3070609c18f4))
* **sync:** use timestamp cursor in sync_group and metadata ([ad657fe](https://github.com/xebjhm/SakaDesk/commit/ad657fe8cdc904dc49540eee7886673bfe1a122e))
* timestamp downloads, golden finger redesign, chat cache, adaptive sync ([4273143](https://github.com/xebjhm/SakaDesk/commit/42731436e149dd88d1210313af76c5f2133307eb))
* **transcription:** add backend transcription service, API, and search migration ([b2f0f42](https://github.com/xebjhm/SakaDesk/commit/b2f0f424463383df6769363c1d0e36248b139f0f))
* **transcription:** add frontend components, integration, and settings ([3d7e3b2](https://github.com/xebjhm/SakaDesk/commit/3d7e3b232a8af043da936318485b51c597f37842))
* **transcription:** Gemini-only transcription, remove local Whisper model ([86716bd](https://github.com/xebjhm/SakaDesk/commit/86716bde72b8fbd99e9d2cddaffd07e28a0bfb61))
* **transcription:** switch from gemini-2.5-flash to gemini-3.1-flash-lite-preview ([35e3b20](https://github.com/xebjhm/SakaDesk/commit/35e3b20f483ac8d6a3f15f4233144db9548480a2))
* **transcription:** use Gemini structured output for timestamps ([18766d6](https://github.com/xebjhm/SakaDesk/commit/18766d6b8bc83d7b4679a8ef51d55fbd99163e72))
* **translation:** add backend service, API, i18n, and system prompt ([739174f](https://github.com/xebjhm/SakaDesk/commit/739174f8acd2f7e5e0fca98776edc64181dcbcb0))
* **translation:** add error state indicator to TranslateButton ([a7edef8](https://github.com/xebjhm/SakaDesk/commit/a7edef806d4c8cf3ca17453491256f6b68cfe146))
* **translation:** add frontend components, hooks, and integration ([58120e4](https://github.com/xebjhm/SakaDesk/commit/58120e469529ad19b7d6438785261b35276f53ec))
* **translation:** immersive blog translation with DOM injection ([ad95792](https://github.com/xebjhm/SakaDesk/commit/ad957926be3c04e1b6e4c7d4bb0a3e1a988914ed))
* **translation:** unify translate button, add error state in blog ([94f8715](https://github.com/xebjhm/SakaDesk/commit/94f8715991971d9a9abe80406c88f93de1b1e5eb))
* trigger blog backup start/stop from settings toggle ([b03ab56](https://github.com/xebjhm/SakaDesk/commit/b03ab56168501ead3972941c0bc4f9ed62cbdf5a))
* **types:** add local_url to BlogContentResponse images ([745486b](https://github.com/xebjhm/SakaDesk/commit/745486bb7aa5d544f6597f0c53c26a4c1b08da17))
* **ui:** add rerun buttons for transcription and translation ([58df445](https://github.com/xebjhm/SakaDesk/commit/58df445afdc4e5ace0043caf9c53232c0d7f62e2))
* **ui:** app-styled confirm dialog for Deep re-verify (replaces window.confirm) ([952ba15](https://github.com/xebjhm/SakaDesk/commit/952ba1545b9615dbf0c176666f36be4d4e1b7dee))
* **ui:** auto-expand/collapse transcription and translation panels ([cc5d45e](https://github.com/xebjhm/SakaDesk/commit/cc5d45ea45580308a78ddbd113171eaad310bce5))
* unified MediaViewerModal for photos, videos, and voice ([8d6a401](https://github.com/xebjhm/SakaDesk/commit/8d6a401afcf4ee38254455dc414b80891fef1a0b))
* **upgrade:** add error cache TTL, download verification, and banner improvements ([3c15d15](https://github.com/xebjhm/SakaDesk/commit/3c15d150256f0ebc9bf97b1d908466fe7a812fdb))
* **upgrade:** redesign upgrade system per design doc ([70511e9](https://github.com/xebjhm/SakaDesk/commit/70511e99b7b58d7e50855e0eb71d7c7c38ba314b))
* **verify:** honest media-completeness reporting + focus verify progress ([82c5b83](https://github.com/xebjhm/SakaDesk/commit/82c5b83e9b4ca19e39e76f731ea870216b7d1cfd))
* **verify:** show validation results (no auto-close) with a per-item list ([d44d0d6](https://github.com/xebjhm/SakaDesk/commit/d44d0d6b4ff97cccb38c96bde78ed56a3bda3394))
* **video:** replace auto-loop with toggle button (default off) ([b615c1e](https://github.com/xebjhm/SakaDesk/commit/b615c1e61adac35082eeb2a218f42c6a380054a3))
* **website:** add landing page with i18n and screenshot carousel ([9897566](https://github.com/xebjhm/SakaDesk/commit/9897566d0b93ab580787da205de4f4d1a3d0de54))
* **website:** add Vercel Analytics for page view tracking ([9976c8e](https://github.com/xebjhm/SakaDesk/commit/9976c8e9a1de0869e06372dd2493f3baeae980c4))
* **website:** track download button clicks with Vercel Analytics ([4b1fa30](https://github.com/xebjhm/SakaDesk/commit/4b1fa302f09dbf63b3508ee20779450fcad8b0f2))


### Fixed

* address code review findings — dead code, assert, deprecated API ([b8137e8](https://github.com/xebjhm/SakaDesk/commit/b8137e8ae6a8632dddaaca2f5912d2325d370fbf))
* address PR review findings ([6b9df88](https://github.com/xebjhm/SakaDesk/commit/6b9df88ecd1b2809aa3d6deb7053d106b6402e5f))
* **ai:** default translation model + log translation/transcription HTTP boundaries ([0d6e4c8](https://github.com/xebjhm/SakaDesk/commit/0d6e4c8c2b3d21942d12ae8fd1de7c58287df546))
* **ai:** rerun buttons now force a fresh AI call and have clear tooltips ([0d996f3](https://github.com/xebjhm/SakaDesk/commit/0d996f3bd8032c81e5381f5f060fd036daa1f9b5))
* **api:** align Gemini API usage with official documentation ([a2a0fa0](https://github.com/xebjhm/SakaDesk/commit/a2a0fa0f13ead58a40bcf1470e4717bac3d72cbe))
* **api:** replace str(e) in 500 responses with generic error message ([c247c2e](https://github.com/xebjhm/SakaDesk/commit/c247c2efc1b522297c77c03a5ef427447d4b2892))
* **auth:** add reconnection cooldown to prevent login dialog re-trigger ([1884a8d](https://github.com/xebjhm/SakaDesk/commit/1884a8db40237384af26425e6bda58e099732859))
* **auth:** detect Yodel region by geo-IP, not endpoint probe ([41f46c2](https://github.com/xebjhm/SakaDesk/commit/41f46c25e38946886bb8c1f339f9d250b90fdaad))
* **auth:** persist rotated refresh_token on refresh (parity with sync_service) ([50f94c7](https://github.com/xebjhm/SakaDesk/commit/50f94c7b2b9baf68a455f3d61a4faaad541fbbd3))
* **auth:** preserve disconnect state when checkAuth refreshes ([5ec3282](https://github.com/xebjhm/SakaDesk/commit/5ec3282fa5d2afa0ba91caa19f2b919b73509c00))
* **auth:** prevent concurrent browser login launches ([26c3c76](https://github.com/xebjhm/SakaDesk/commit/26c3c76a8e22d8cbc4c8e203f1e1e47d87157b06))
* **auth:** Yodel geo-check sent no app headers -&gt; 400 -&gt; always "blocked" ([f06d066](https://github.com/xebjhm/SakaDesk/commit/f06d066eff80fcacc453297a71f467995a98cf7f))
* **backend:** include user_nicknames in settings API response ([3ce8ea4](https://github.com/xebjhm/SakaDesk/commit/3ce8ea4890080fc088026a3e1160bc8efaf364da))
* **backend:** resolve all mypy type errors for stricter type checking ([418d7ef](https://github.com/xebjhm/SakaDesk/commit/418d7ef2100269b32304680669936aefb597ebc4))
* **backend:** transcription, translation, blog & sync-error contract fixes ([ff2c3f0](https://github.com/xebjhm/SakaDesk/commit/ff2c3f051ea1caf18542c13da7c0b21f97147aca))
* **backend:** wire app_state handlers and warm-up to async offload ([cdeacba](https://github.com/xebjhm/SakaDesk/commit/cdeacba1b11d44ddf3cc642283c2d3b057ee50c7))
* blog timeline fisheye overflow and dwell sensitivity ([93a24fc](https://github.com/xebjhm/SakaDesk/commit/93a24fc0ec86afffa3dcd56bf5f7c090c3bb6162))
* **blog:** bind datetime before use in metadata sync ([cb8d771](https://github.com/xebjhm/SakaDesk/commit/cb8d7716dd14615e4ccaccb92a27f9871a786873))
* **blog:** bound concurrent image downloads to prevent timeout ([d664cd3](https://github.com/xebjhm/SakaDesk/commit/d664cd36122cde2be53ccf5af795be65a177aa01))
* **blog:** non-200 image cache poison + backup force-restart race (SVC-I6, SVC-I8) ([61a77e1](https://github.com/xebjhm/SakaDesk/commit/61a77e1ebefa6c1119d0af6c500220a12adc0b2d))
* **blog:** prevent backup restart when start() called on running task ([84a9c86](https://github.com/xebjhm/SakaDesk/commit/84a9c86860e8a334c0559cc0233242aa746eeb19))
* **blogs:** add local_url to BlogImage response model ([058e12b](https://github.com/xebjhm/SakaDesk/commit/058e12b08c89fc7469ae64eb9c3aeb52b5275f9a))
* **blog:** sanitize member names in cache paths for Windows ([fced27f](https://github.com/xebjhm/SakaDesk/commit/fced27f8d707f5c1fdf4d94abead1ddc2eee3975))
* **blogs:** retry index.json atomic-replace on transient Windows locks ([dedb01f](https://github.com/xebjhm/SakaDesk/commit/dedb01f979b55d605d4d3734777560c630d72565))
* **blog:** track permanently removed blogs to prevent re-download loop ([a33469e](https://github.com/xebjhm/SakaDesk/commit/a33469efe4677963670b8d897fdf4145be8c85ac))
* **blog:** use atomic write for blog index to prevent corrupt reads ([59db70b](https://github.com/xebjhm/SakaDesk/commit/59db70b071b5eb52d14ff41635106143dab0ce0d))
* cache user nickname during sync to eliminate %%% placeholder ([f339d91](https://github.com/xebjhm/SakaDesk/commit/f339d911d8005b971aa33dc025488e3356e7c25c))
* catch pykakasi errors during index build to prevent full abort ([555fde6](https://github.com/xebjhm/SakaDesk/commit/555fde6ed2e575a954e64fefc28adccd463184e7))
* centralize settings file access behind asyncio.Lock to prevent race conditions ([5371ba2](https://github.com/xebjhm/SakaDesk/commit/5371ba2a0ffcc4d7f468ad6442719afb804b8d42))
* change default output_dir from CWD/output to ~/Documents/HakoDesk ([7c852f8](https://github.com/xebjhm/SakaDesk/commit/7c852f8c7bbabae2faca596e2baaab2f016df0c0))
* **ci:** fix E402 noqa placement and lower frontend coverage threshold ([ffd0bb4](https://github.com/xebjhm/SakaDesk/commit/ffd0bb4905b2551856be2c7a59c5401567e38d94))
* **ci:** stabilize CI pipeline ([90e41b3](https://github.com/xebjhm/SakaDesk/commit/90e41b34076cba7697cc1368ae3f9ee18763934f))
* compact report issue URL and copy diagnostics to clipboard ([1733141](https://github.com/xebjhm/SakaDesk/commit/1733141d71ebd35823ee655154368204ecf36323))
* **content:** add Sakura/Nogi official group IDs to GROUP_CHAT_IDS ([e83021a](https://github.com/xebjhm/SakaDesk/commit/e83021ae6cb5c2ad843f9c9e1ad57dd8009b3348))
* **content:** log unknown-service group request; review follow-ups ([e14e6e8](https://github.com/xebjhm/SakaDesk/commit/e14e6e82c92b19d385683aa601b2a4c86cb72144))
* **content:** make backend is_group_chat the single source of truth for group classification (FC-M13) ([#11](https://github.com/xebjhm/SakaDesk/issues/11)) ([a944dcd](https://github.com/xebjhm/SakaDesk/commit/a944dcddab8d132bb698ea39665d4d6aecf5b870))
* **content:** stop cross-service unread badge collision ([c56f02c](https://github.com/xebjhm/SakaDesk/commit/c56f02c7778810d33a74dce1290ee650d1403c26))
* critical bugs found in final review ([4a0e6da](https://github.com/xebjhm/SakaDesk/commit/4a0e6da16821d79764edf32b4d2d2fd8973b2d22))
* **desktop:** add freeze_support() to prevent duplicate app on Windows ([da7c48b](https://github.com/xebjhm/SakaDesk/commit/da7c48b50df6c0f6bade8edc565fdf6001dc6217))
* **desktop:** make DPI window-geometry correct at any scale + per-monitor ([6f8fe38](https://github.com/xebjhm/SakaDesk/commit/6f8fe382643e7036b571e9432cc5f479303d5cd1))
* **desktop:** migrate window geometry from window.json to settings.json ([3d5a627](https://github.com/xebjhm/SakaDesk/commit/3d5a62758f6f9177ea5fe05f42f9ea020947d2b0))
* **desktop:** prevent window geometry shrinkage on restart ([171bfbd](https://github.com/xebjhm/SakaDesk/commit/171bfbd927ba39293f45b73047c1cbcb14641c21))
* **desktop:** read window size directly on close, remove DPI division ([807fdf7](https://github.com/xebjhm/SakaDesk/commit/807fdf782640aaf6745ce170e72d45996b76894a))
* **desktop:** single-instance guard, startup timeout, safe geometry ([6d02a70](https://github.com/xebjhm/SakaDesk/commit/6d02a705f8233ed295b9ed25516d36de7efc2db6))
* **desktop:** stop Playwright console windows popping up in packaged app ([406ef93](https://github.com/xebjhm/SakaDesk/commit/406ef93bdb2394ef07c9cc40427b5232a6df1e92))
* **desktop:** stop window growing on every restart at non-100% DPI ([16ecbbb](https://github.com/xebjhm/SakaDesk/commit/16ecbbb1b41967155abbc1208a161dde3d9f221a))
* **desktop:** stop window shrinking every restart at non-100% DPI ([2def4d3](https://github.com/xebjhm/SakaDesk/commit/2def4d3586f2810ed02265fbd8d80004c0a1e8bb))
* diagnostics panel shows actual sync mode (Off/Smart/interval) ([b8c83e5](https://github.com/xebjhm/SakaDesk/commit/b8c83e5aee167f0761577a9f45b2fc3276af6e1c))
* **diagnostics:** read from dedicated error.log and fix log level filters ([0876873](https://github.com/xebjhm/SakaDesk/commit/0876873bf39373a33cc208e44fb0d3d9c591336e))
* **download:** use backend endpoint for file downloads in pywebview ([ef22d07](https://github.com/xebjhm/SakaDesk/commit/ef22d0790c2f3e8baa2cf7a01b873a0487325db2))
* DPI scaling drift on window geometry save/restore ([c4524a7](https://github.com/xebjhm/SakaDesk/commit/c4524a7e51c5f518ae0f608d85546729459ffbbe))
* exclude snapshots from trailing-whitespace hook ([8b6b4c5](https://github.com/xebjhm/SakaDesk/commit/8b6b4c5b3b58eebfbe047ec73aa2e75ec384833c))
* **favorites:** scope per-service, write atomically, off the loop ([563f4ad](https://github.com/xebjhm/SakaDesk/commit/563f4adffc2576ac3f31b0e9d998e2cebf49c746))
* **frontend:** add optimistic toggle for blog backup setting ([2e5e88c](https://github.com/xebjhm/SakaDesk/commit/2e5e88cb6937a0d588c43bb5fc1e50ecacd9660d))
* **frontend:** fetch nicknames for all services on startup ([82a5323](https://github.com/xebjhm/SakaDesk/commit/82a5323159401d6e3ff6495b5036cf1f209a75ba))
* **frontend:** localize verify phase headers and polish summary ([56b0550](https://github.com/xebjhm/SakaDesk/commit/56b0550bd38e61153f28760faf9b777192bc476b))
* **frontend:** persistence flush, sync errors, timezone, fetch races ([2b70f3d](https://github.com/xebjhm/SakaDesk/commit/2b70f3d7e086c3e1d9836aa1688b6c659bfb0d02))
* **frontend:** resolve ESLint errors and update snapshot ([e0a7f88](https://github.com/xebjhm/SakaDesk/commit/e0a7f88b1877e3e69224a16a62df8e8168ded375))
* **frontend:** resolve TypeScript errors in BlogsFeature and SyncModal test ([ef11839](https://github.com/xebjhm/SakaDesk/commit/ef1183953f202dd764e980cc1fc8f102c5eec3c2))
* fullscreen-safe Escape and DetailModal close ordering ([fbe91c7](https://github.com/xebjhm/SakaDesk/commit/fbe91c72f1817ceabc538a88188df7c5ea647f9f))
* gallery keyboard nav follows grid reading order, counter shows oldest=1 ([d37f7f6](https://github.com/xebjhm/SakaDesk/commit/d37f7f65649c6a7684e7fdc046409067c1aa6aa5))
* honor SAKADESK_DATA_DIR when computing the log directory ([aefb520](https://github.com/xebjhm/SakaDesk/commit/aefb520b6f7973faf82bdf66b3c9a37784c7926a))
* i18n cross-locale alignment and consistency ([75caa38](https://github.com/xebjhm/SakaDesk/commit/75caa388db5a00de2f338b5704d75a99dbfb7c9a))
* **i18n:** improve Japanese subscription duration text ([5251246](https://github.com/xebjhm/SakaDesk/commit/5251246f484487f549dcd815e70c24468888f004))
* **i18n:** localize subscription period in MemberProfilePopup ([64f0aa7](https://github.com/xebjhm/SakaDesk/commit/64f0aa7eb82a467bd03647a326aa2d831f2634d6))
* **i18n:** make persisted language the single source (no startup race) ([877f4c1](https://github.com/xebjhm/SakaDesk/commit/877f4c1a6d399180812287ee5831533a21c261f5))
* **i18n:** rename transcriptionDevice label to just transcription ([3846f37](https://github.com/xebjhm/SakaDesk/commit/3846f37446a32d3e5f15f420ecc7c77e20c6b9cd))
* **i18n:** reword web auth-mode description (periodic re-login) ([4bd8f1f](https://github.com/xebjhm/SakaDesk/commit/4bd8f1f4b17208535da38c42b9dfaa439666f657))
* **i18n:** tweak zh-TW web auth-mode wording ([1399a8b](https://github.com/xebjhm/SakaDesk/commit/1399a8b75b05bd9ae720fd2b70dcd1b242294992))
* **installer:** correct stale credential + auth-dir cleanup on uninstall ([23442d4](https://github.com/xebjhm/SakaDesk/commit/23442d48acfbc5831db81912aeaa37da1c3ce243))
* **installer:** remove untracked runtime files on uninstall ([50b379e](https://github.com/xebjhm/SakaDesk/commit/50b379e1ae5538055662bca01c8b33110953a4c5))
* isolate settings tests to prevent writing to real config ([8888325](https://github.com/xebjhm/SakaDesk/commit/8888325d1db9c9b253edbb6c53017b73faf9a260))
* **lint:** satisfy CI lint gate (ruff format + mypy) ([f9d87a4](https://github.com/xebjhm/SakaDesk/commit/f9d87a45e14efbbf56400ee4951b7ded6a53ba98))
* **logging:** convert structlog f-string calls to structured keyword args ([912ea9c](https://github.com/xebjhm/SakaDesk/commit/912ea9c0694b794fb97ba496e63a2af1a4f926c7))
* **media-gallery:** per-row transcript preview in voice list ([33edae4](https://github.com/xebjhm/SakaDesk/commit/33edae40cd0b2efcd244a86eddad49fa18a3d49a))
* **media-gallery:** reset detail/voice state when jumping to message ([96427a1](https://github.com/xebjhm/SakaDesk/commit/96427a1ed77f8732283804dd2fb52f295fc6d62f))
* **media-gallery:** sync voice transcript highlight with playback time ([91f4f1e](https://github.com/xebjhm/SakaDesk/commit/91f4f1e0222f5dba63e6d8fac5685233bf3efc26))
* **media-gallery:** transcript panel above voice player, auto-expanded ([9232e65](https://github.com/xebjhm/SakaDesk/commit/9232e65c58b0df0e2c53f408c61fee165305847d))
* **media:** stop transcription caption lines overlapping in fullscreen ([2b44539](https://github.com/xebjhm/SakaDesk/commit/2b44539409a222c9d2e4b434e07263cb955ad285))
* **media:** wire transcription segments to inline video player again ([a002dd8](https://github.com/xebjhm/SakaDesk/commit/a002dd83516dfb32fbcbeac122c843bba21799db))
* **models:** auto-reset stale model names to default on config load ([5e7ed19](https://github.com/xebjhm/SakaDesk/commit/5e7ed19e518d4cad424c9e89066857f7c6880f72))
* namespace server_groups by service to prevent cross-service ID collisions ([b8312a8](https://github.com/xebjhm/SakaDesk/commit/b8312a8c43e8c2fb89ebb745c71e9c728991643c))
* **persist:** migrate translation cache under its full key ([c10e315](https://github.com/xebjhm/SakaDesk/commit/c10e315bfcdbbe3942ea5d474c18355510a9f69f))
* **persist:** move app-state store bundle to backend (survives port shift) ([1cf3b24](https://github.com/xebjhm/SakaDesk/commit/1cf3b24d34e319275b09fe8331f9ae3436113b80))
* **photo-detail:** sync voice/video transcript highlight with playback ([876ef6d](https://github.com/xebjhm/SakaDesk/commit/876ef6d57671dc03178a89e0e8be5804c4410a14))
* properly shut down uvicorn on close to prevent port conflict on reopen ([3612f98](https://github.com/xebjhm/SakaDesk/commit/3612f98a80e73237a40ba596d5e7495c88514b40))
* **release:** version-tag guard, pysaka pin, safe uninstall, exit order ([ad28b99](https://github.com/xebjhm/SakaDesk/commit/ad28b996d07d3f560323f40af07b4e6f18ecb1ba))
* remove OnboardingLoginFlow blocking, restore free blog browsing ([d15b021](https://github.com/xebjhm/SakaDesk/commit/d15b021c78097312177fb8d787d74c5f777cbf36))
* remove premature last_full_build flag from incremental indexer ([86dbb54](https://github.com/xebjhm/SakaDesk/commit/86dbb544abcedaa3a713c18e45c6e8c5e2a68f6a))
* remove sticky positioning from member list section headers ([ba83f93](https://github.com/xebjhm/SakaDesk/commit/ba83f93baddc75a7b76424714a86897f5781e608))
* **report:** scrub full diagnostics payload before public issue URL (WP-11) ([169b1f2](https://github.com/xebjhm/SakaDesk/commit/169b1f2b76c829d01b9e0264bad3e58391e2625b))
* resolve code-review findings — data, races, release, privacy ([3263422](https://github.com/xebjhm/SakaDesk/commit/326342286e6d0880267f47080d85378dc0bdb7c9))
* resolve mypy type errors and update VoicePlayer snapshot ([0786cb3](https://github.com/xebjhm/SakaDesk/commit/0786cb3c07a540dfd2a367bd9f57f346f29fde68))
* resolve PR-review findings across translation, sync, upgrade ([ea10e4c](https://github.com/xebjhm/SakaDesk/commit/ea10e4cb80e89cbaab05de954a86003f68d839bb))
* resolve ruff lint and format errors for CI ([f23f81f](https://github.com/xebjhm/SakaDesk/commit/f23f81f3bbfeca08b5e2faa245f3e3940fa9ef1c))
* resolve sync cascade, settings contention, and blog timeout storm ([d419530](https://github.com/xebjhm/SakaDesk/commit/d4195305f5fa10f99c9b98b40c8309158f02a0c1))
* resolve test failures and mypy errors ([6eee602](https://github.com/xebjhm/SakaDesk/commit/6eee60238a03350bea9f4f0e17aa10e243caff00))
* resolve TS errors and update test for groups API response format ([46eb886](https://github.com/xebjhm/SakaDesk/commit/46eb886305aa8d73dc3ec8ec7140f150439e620f))
* **review:** address PR review findings — dead code bug, error handling, i18n, tests ([e4a81df](https://github.com/xebjhm/SakaDesk/commit/e4a81df3b57a968e0f720ae3941e6b8e8c25eba3))
* search — index building UI, member filter dedup, result improvements ([612011e](https://github.com/xebjhm/SakaDesk/commit/612011ec8ec17631f454ecec4f7b22daba91352e))
* search service — remove migrations, consolidate duplicate members ([88e643e](https://github.com/xebjhm/SakaDesk/commit/88e643e8355e553af9ee4e24c9470daa04272f5d))
* **search:** clip child elements to modal rounded corners ([f3d822b](https://github.com/xebjhm/SakaDesk/commit/f3d822b608b845feb60cd0257fe262e365581631))
* **search:** cross-thread rebuild close + FTS ghost-row prevention (SVC-I4, SVC-I5) ([b6a20af](https://github.com/xebjhm/SakaDesk/commit/b6a20af4d57d7e20f3e1f0c77e40e9b287391dc1))
* **search:** key dedupe and counts by (service, message_id) ([2c6e8f5](https://github.com/xebjhm/SakaDesk/commit/2c6e8f5f117e58dd70a2d8870b0f90a9bd55fe8e))
* **search:** pass matched terms to BlogReader for reading-based highlight ([63af7c6](https://github.com/xebjhm/SakaDesk/commit/63af7c6529188b3da2c887568c2628236dd5e5b1))
* **search:** sanitize search snippets with DOMPurify to prevent XSS ([6f83429](https://github.com/xebjhm/SakaDesk/commit/6f834293003b5466bd3dc7b96b2c6efce0981317))
* **search:** shorten blog snippet max_len so highlights are visible ([8a4a28b](https://github.com/xebjhm/SakaDesk/commit/8a4a28b7e8f63291c5e3aea0b39b1e8c51e3b100))
* **search:** show partial results while search index is building ([f9a5874](https://github.com/xebjhm/SakaDesk/commit/f9a5874ad37113741d0dfbea800ba709234f533c))
* **search:** sort combined results by match_type (exact &gt; reading) then timestamp ([55b8e67](https://github.com/xebjhm/SakaDesk/commit/55b8e6766a3e850d717ccb9e4d7809d93f0a19b3))
* **search:** validate member_ids integer conversion with proper 400 error ([7bd3a47](https://github.com/xebjhm/SakaDesk/commit/7bd3a4777813af4a93e7b5b05cda7389536a048c))
* **security,media,translation:** release review remediation ([370f500](https://github.com/xebjhm/SakaDesk/commit/370f5005616dd737f0ffb48556c49e617ccb9708))
* **security:** non-redirecting, size-capped blog image proxy (API-I3) ([ce0b22a](https://github.com/xebjhm/SakaDesk/commit/ce0b22a99e1c49eaa32b1f2a6a8db58a8877b0a0))
* **security:** path-traversal guard in get_message_dates (API-I2) ([7adb9fd](https://github.com/xebjhm/SakaDesk/commit/7adb9fd8ad0dc348094243fad775d955c3a3c115))
* **security:** restrict self-upgrade download to HTTPS GitHub hosts (SEC-4) ([67c8eae](https://github.com/xebjhm/SakaDesk/commit/67c8eae5ed50090986bfd9047ef118e2c39dc946))
* **security:** scrub secrets from diagnostics/report log output (SEC-5) ([22a3d69](https://github.com/xebjhm/SakaDesk/commit/22a3d69a6f53de6837b1b6c30f98bfcab00968fb))
* **security:** SPA path-traversal + rebinding/CSRF hardening (SEC-1, SEC-2) ([21da06b](https://github.com/xebjhm/SakaDesk/commit/21da06b62a555cdbaaa870dee5eb722ff8f644e7))
* **server:** serve index.html with no-cache headers ([a3ff2a3](https://github.com/xebjhm/SakaDesk/commit/a3ff2a387bf92a54156ac8ab2347dfe56a290cd5))
* ServiceRail drag compatibility and TosDialog link order ([40b8871](https://github.com/xebjhm/SakaDesk/commit/40b8871901fb1231add765bca0a619aca12f215c))
* **settings:** centralize defaults in settings_store ([3668ffc](https://github.com/xebjhm/SakaDesk/commit/3668ffc5cb7cd54853dce68212f750c80598d824))
* **settings:** correct Gemini info-text i18n key path ([74f7a79](https://github.com/xebjhm/SakaDesk/commit/74f7a79e3762320e96930c2c2827235e0306de7e))
* **settings:** drop Japanese translation target + fix constant panel height ([a8f8697](https://github.com/xebjhm/SakaDesk/commit/a8f869785330c12f952315530fec77566a61a258))
* **settings:** instant AI-tab reopen + i18n API-key errors ([ca55c89](https://github.com/xebjhm/SakaDesk/commit/ca55c8942984ac95f52243b65d6639829dedc407))
* **settings:** plain-language sign-in mode copy + roomier layout ([9cde716](https://github.com/xebjhm/SakaDesk/commit/9cde71631af1b8acd57820f83fd28861fff2252f))
* **settings:** replace blocking thread.join with async executor ([e9d361e](https://github.com/xebjhm/SakaDesk/commit/e9d361e71d9008ff3b53e5ca6323eae84ca0c9ae))
* **settings:** tighten mobile-auth copy + uncrowd auth toggle ([3057e03](https://github.com/xebjhm/SakaDesk/commit/3057e03de86852c2f11816506c4e28f5a2ed9fd1))
* **setup:** defer blogs_full_backup save until after fresh sync ([ecf9e1a](https://github.com/xebjhm/SakaDesk/commit/ecf9e1ad552894333241c18816022f24f4b85f78))
* **shell:** re-evaluate ToS acceptance after prefs hydration (no upgrade re-gate) ([d9f6aa3](https://github.com/xebjhm/SakaDesk/commit/d9f6aa3884873378e874ae3b1849a560bc46623c))
* **shutdown:** drain background tasks + verify + refuse new writers during shutdown ([5a3257f](https://github.com/xebjhm/SakaDesk/commit/5a3257f9de1cfedaa5de0385f75b19a03fab59e8))
* **shutdown:** refuse upgrade download during shutdown + document drain order ([d364b22](https://github.com/xebjhm/SakaDesk/commit/d364b2220cffc14ee13513b8a6206900c579a137))
* **shutdown:** terminate ProcessPoolExecutor workers on app exit ([ec93c53](https://github.com/xebjhm/SakaDesk/commit/ec93c539b5e54162ba72362ba97550f5fe1fd5af))
* **store:** gate persistence until hydration to stop state wipe ([63ee181](https://github.com/xebjhm/SakaDesk/commit/63ee18106a0738d8e7dafb1b461e858c216d2328))
* **sync:** add background_tasks helper the cherry-picked SVC-M1 fix needs ([9636923](https://github.com/xebjhm/SakaDesk/commit/9636923aacc081c10a5ae129ed09f6bb0855c8b0))
* **sync:** atomic write for sync_metadata.json ([3ed5090](https://github.com/xebjhm/SakaDesk/commit/3ed5090e8b4f1bfbf6ab054ccdf42a5092d7b8d3))
* **sync:** build fresh SyncManager per verify run to avoid stale token ([3bbc327](https://github.com/xebjhm/SakaDesk/commit/3bbc3277c2a2aca0430362ae6cab26624776548d))
* **sync:** data-driven adaptive sync from 13k Hinatazaka messages ([0f09787](https://github.com/xebjhm/SakaDesk/commit/0f09787564a7e7f41108d3d82d0010a9e7cf9028))
* **sync:** force resync no longer resets read/unread state ([4950de3](https://github.com/xebjhm/SakaDesk/commit/4950de3f470191f9a6c6b4a0bbedf0ba4cdcd723))
* **sync:** initialize metadata_file in __init__ with runtime guard ([0aea840](https://github.com/xebjhm/SakaDesk/commit/0aea84076e54c22456b067cc15926fe46422fe9d))
* **sync:** keep full member history on first sync ([971b117](https://github.com/xebjhm/SakaDesk/commit/971b117b16bbdf925c2a672ed09eeb2c10771954))
* **sync:** make /cancel actually cancel a running verify pass ([37affc8](https://github.com/xebjhm/SakaDesk/commit/37affc8a943d35aa7325f457be60795eccdd5dca))
* **sync:** make mark-read fire reliably on cold start, collapse double lookup ([fd4deab](https://github.com/xebjhm/SakaDesk/commit/fd4deabc876c30df221744270df608e418090001))
* **sync:** move search indexing to background to unblock Phase 3 ([6df638b](https://github.com/xebjhm/SakaDesk/commit/6df638b69f8d5ba73716b8307d1470884e9df507))
* **sync:** remove unsynced member seeding on fresh sync ([5023032](https://github.com/xebjhm/SakaDesk/commit/502303288beda70d0c3039eca69496af3f755272))
* **sync:** resolve SVC-C1/I1/I2/I3/I9 from 2026-07-02 code review ([a8fa9aa](https://github.com/xebjhm/SakaDesk/commit/a8fa9aafab3a8c0d5321a3bd6e81b57494bd1c5c))
* **sync:** sync modal no longer looks stuck after completion ([05574f8](https://github.com/xebjhm/SakaDesk/commit/05574f8d42b946bc9b3f5714d9d51d30f04c5fd4))
* **sync:** sync newly connected services instead of only first one ([6beeae3](https://github.com/xebjhm/SakaDesk/commit/6beeae352e7f983abfefb7b1a3118bcf80aa5429))
* **sync:** use &gt;= for timestamp filter in check_new_messages ([c1de91f](https://github.com/xebjhm/SakaDesk/commit/c1de91f49ad449a98deb229f7e06fc87e3db20c5))
* **sync:** use refresh_profile to pick up nickname changes ([9cf5d85](https://github.com/xebjhm/SakaDesk/commit/9cf5d85a3dec76cdc75342f18af5f39b82c0b62d))
* **tests:** isolate the test run from the real ~/.SakaDesk data dir ([a43e873](https://github.com/xebjhm/SakaDesk/commit/a43e873251df337de84e17567495fa37792f4812))
* **tests:** update sync endpoint tests for new service-based API ([7be84b4](https://github.com/xebjhm/SakaDesk/commit/7be84b4233ac80245073b1d282f77a5f38f52547))
* **transcription,auth,media,i18n:** code-review fixes ([f1e5590](https://github.com/xebjhm/SakaDesk/commit/f1e559083ac073cc7e14a839ad735744f627f457))
* **transcription,media,blogs:** resolve verified code-review races and leaks ([70b3968](https://github.com/xebjhm/SakaDesk/commit/70b3968410b27890a107712a8041cd6a5ea5dba5))
* **transcription:** improve segmentation and kanji accuracy in prompt ([679d0ce](https://github.com/xebjhm/SakaDesk/commit/679d0ce4dbb402ace6a530ebe9cbabc7a6811aee))
* **transcription:** read model from settings instead of hardcoded default ([669d098](https://github.com/xebjhm/SakaDesk/commit/669d0983bfca7620082a5f7d2df910250db12362))
* **transcription:** skip audio-less videos instead of hallucinating ([90c3a25](https://github.com/xebjhm/SakaDesk/commit/90c3a2538ce0f8efd7a8aec131aa66961df21634))
* **transcription:** wire subtitles in gallery, validate provider setting ([24d322e](https://github.com/xebjhm/SakaDesk/commit/24d322e1baa4326a32d6ef577d860e8f63ebca25))
* **transcript:** use getBoundingClientRect for auto-center math ([4d044f7](https://github.com/xebjhm/SakaDesk/commit/4d044f7e207978798be317d3b1bf5ff9d197ac6c))
* **translation:** post-release hardening of deferred review items ([fec0345](https://github.com/xebjhm/SakaDesk/commit/fec03451e1a11801d0df487fd314180b6aa19cd7))
* **translation:** surface missing API key instead of a stale "saved" status ([88a8fff](https://github.com/xebjhm/SakaDesk/commit/88a8fffa9329908c3d909b8ac102be0362b2c184))
* **translation:** update Gemini models to GA IDs + i18n the tier info ([68c09bf](https://github.com/xebjhm/SakaDesk/commit/68c09bf1b1086718b626077e2cb6da6b7f469b19))
* **types:** clear the mypy + ruff-format lint gate for release ([59169f8](https://github.com/xebjhm/SakaDesk/commit/59169f8a47cfb7fcbdb538dc81193cb5988ba69e))
* **types:** ignore Windows-only msvcrt attrs for Linux CI mypy ([c555303](https://github.com/xebjhm/SakaDesk/commit/c555303ed674b8be11bbbd9feb5e04a7e8090060))
* **types:** resolve pre-existing mypy errors in backend ([d262f01](https://github.com/xebjhm/SakaDesk/commit/d262f01b5131de0937c4f7becde05a46e42ad50c))
* **ui:** correct auto-expand/collapse, subtitle visibility and sizing ([e9ca4c8](https://github.com/xebjhm/SakaDesk/commit/e9ca4c83db6d45655dbf7f2a6a49e7141807850e))
* **ui:** rewrite message panel auto-expand/collapse ([7376093](https://github.com/xebjhm/SakaDesk/commit/737609395904a6a4cc7cb90f73b4433c244552c1))
* **ui:** skip initial IntersectionObserver callback for auto-collapse ([1615565](https://github.com/xebjhm/SakaDesk/commit/1615565e5cfd46d2ebaa81b9fb2dda144f6600fa))
* uninstaller cleanup — credential format, PyHako auth data, search deps ([c29525a](https://github.com/xebjhm/SakaDesk/commit/c29525ab4413742974446f6c8b03f6a9c8e5232e))
* update repository URLs to new SakaDesk repo ([ab97b65](https://github.com/xebjhm/SakaDesk/commit/ab97b6589797c49c2c5202b16b150ace76adc89d))
* update sync detail during search index phase to avoid stale 'already cached' message ([b773f46](https://github.com/xebjhm/SakaDesk/commit/b773f46f45d53d81ce1acee8da995348f4609d80))
* update tests for settings_store refactor and golden finger gating ([b95e30f](https://github.com/xebjhm/SakaDesk/commit/b95e30f9784092531facc01c5f75d16d1208e3b0))
* **upgrade:** address issues found during Windows upgrade testing ([8256edd](https://github.com/xebjhm/SakaDesk/commit/8256edde0a4feca1bf63e13a086ce28d9c109fa6))
* **upgrade:** close running app via WM_CLOSE + guard mutex-name sync ([941c2eb](https://github.com/xebjhm/SakaDesk/commit/941c2eb319de0b3eeac22c8a67bb0ef5d2daea4b))
* **upgrade:** wait for the app to fully exit before replacing files ([aecdc32](https://github.com/xebjhm/SakaDesk/commit/aecdc32ed643ba72f17bf9d647ac1001923967ed))
* **upgrade:** widen useCallback deps to satisfy React Compiler ([ea6d51e](https://github.com/xebjhm/SakaDesk/commit/ea6d51e94ad030ef3b585515f35c3e32983e7fa0))
* use detail page as single source of truth for blog metadata ([02aec0c](https://github.com/xebjhm/SakaDesk/commit/02aec0cfce9e307d4db2ae0c79e7ec51f16fb3fb))
* use precise datetime from Sakurazaka blog detail pages ([ad26ec7](https://github.com/xebjhm/SakaDesk/commit/ad26ec7a3b6919256256063b68e7ca12821a4b29))
* verify is_configured guard, progress total, distinct button label ([376bb10](https://github.com/xebjhm/SakaDesk/commit/376bb10c4260d61f91a51edb0460a6cc8a14ccbc))
* **version:** manual "Check for updates" forces a live fetch (bypasses cache) ([9df2db5](https://github.com/xebjhm/SakaDesk/commit/9df2db54b0a96ef98e81ac8759040ae7620d00fa))
* **video:** show three-dot menu in fullscreen mode ([50fcf96](https://github.com/xebjhm/SakaDesk/commit/50fcf9643a695155d4e1caf3e1a13f1e7cc85e19))
* **video:** subtitles in media-gallery detail view, hide CC in bubble ([3b770e0](https://github.com/xebjhm/SakaDesk/commit/3b770e06138efe87a6ab1005bf1f93f011d9cce9))
* **video:** wire transcription segments to VideoPlayer for subtitles ([a1902a2](https://github.com/xebjhm/SakaDesk/commit/a1902a2534333c5587edd32708f371fb17df7b7f))
* **voice:** disable auto-repeat by default on voice player ([35df3cb](https://github.com/xebjhm/SakaDesk/commit/35df3cbe19d46656633fcc3248ec8e6c14dd3623))
* **website:** internationalize all user-facing strings and fix comments ([6c7e7be](https://github.com/xebjhm/SakaDesk/commit/6c7e7be67f9cc72b74e11cde6c6c810fab1892da))


### Changed

* **ai:** cache the keyring read behind /api/translation/config ([f76d5a7](https://github.com/xebjhm/SakaDesk/commit/f76d5a7fd1ab99f840ba07299d7999eafae6df31))
* **api:** migrate from deprecated on_event to lifespan context manager ([ae73798](https://github.com/xebjhm/SakaDesk/commit/ae73798fe5de85de1f2795705adc3f7ffca91ae4))
* apply unified app theme gradient to SyncModal ([e39ae3b](https://github.com/xebjhm/SakaDesk/commit/e39ae3b34a6e03c47ecdbadc9572e20832eb45f4))
* **auth:** per-service auth mode + redesigned account tab ([6a08ae7](https://github.com/xebjhm/SakaDesk/commit/6a08ae73aaae35f15974c7c2feff7b6c2cc372c1))
* backend API, sync & service improvements ([18e6196](https://github.com/xebjhm/SakaDesk/commit/18e6196b1c2d022ccac17815281adc09369af167))
* backend infrastructure, desktop app & build tooling ([7225aa6](https://github.com/xebjhm/SakaDesk/commit/7225aa664c221cfc3500eeea922b43b573d8e707))
* **backend:** offload blocking I/O and keyring reads off the loop ([50b4808](https://github.com/xebjhm/SakaDesk/commit/50b4808e5d22bc3b234c6f633e3e55c3eb6c6f92))
* **backend:** rename pyzaka to pysaka and apply formatting ([3fce31d](https://github.com/xebjhm/SakaDesk/commit/3fce31d040f1eb9464c8f9cdd2eb371308902c5f))
* **backend:** replace per-member flags with group-level server_groups ([9b83d83](https://github.com/xebjhm/SakaDesk/commit/9b83d83e15e14eeed6eaa9a0bbbef5b864bae63d))
* **blog:** batch detail metadata fetches per member ([ec43cd0](https://github.com/xebjhm/SakaDesk/commit/ec43cd072dd357d98a63a6a953bcadc9860e4105))
* **blog:** move BlogBackupManager to dedicated background thread ([9c78aa5](https://github.com/xebjhm/SakaDesk/commit/9c78aa575ab9e38895af7ae419bba745be9b9062))
* **blog:** offload blocking file I/O in cache stats to executor ([3d59fc0](https://github.com/xebjhm/SakaDesk/commit/3d59fc080b60a2364c0477a649052e1ed487a7d2))
* **blogs:** simplify BlogPhotoGalleryModal ([44566c1](https://github.com/xebjhm/SakaDesk/commit/44566c1e0772bb769caf535bac5fa5b98b2f6a64))
* consolidate memberData, update blog components, remove dead code ([f95f352](https://github.com/xebjhm/SakaDesk/commit/f95f35255bbfe921dd29ce323457c6e6ed991500))
* dedupe state-transition + tidy unification leftovers ([4dcc60f](https://github.com/xebjhm/SakaDesk/commit/4dcc60fc7dbe0e760929cca8da73e6adfdfbb7dc))
* **desktop:** drop sticky .port reuse; bind ephemeral port ([5dba814](https://github.com/xebjhm/SakaDesk/commit/5dba81455e44ae128a6a03160f86b51a0383e8c9))
* fix 3 search index performance issues causing app sluggishness ([b073276](https://github.com/xebjhm/SakaDesk/commit/b07327608a5ea0da23c05cff3ccc3d105270651d))
* fix cross-service blog ID collision and chat room switching flicker ([61c8267](https://github.com/xebjhm/SakaDesk/commit/61c8267da66687be52c11de0937ad72c2f5e02f5))
* **frontend:** centralize app version via __APP_VERSION__ define ([ea53da7](https://github.com/xebjhm/SakaDesk/commit/ea53da767641757aaae489b69afb2fa436034468))
* **frontend:** consolidate color system with CSS variables ([18809c1](https://github.com/xebjhm/SakaDesk/commit/18809c113c790725cdfe61bb62827ea5b04eb8d1))
* **frontend:** consolidate month names and add debug flag for sync ([f7225a0](https://github.com/xebjhm/SakaDesk/commit/f7225a038201ecffb221b2256926c298e33a0719))
* **frontend:** preload logo image to reduce layout shift ([eadfa3b](https://github.com/xebjhm/SakaDesk/commit/eadfa3bbb0237bc19750f33ddcf173950c1eb77a))
* **frontend:** rename zakadesk to sakadesk and externalize strings ([52f132c](https://github.com/xebjhm/SakaDesk/commit/52f132cee65fbcdc1eb92d115a0aeffa645e0d19))
* **frontend:** update brand colors and add primaryColor to service definitions ([fdb3862](https://github.com/xebjhm/SakaDesk/commit/fdb38625761fd05913ff649af05366a0d0be9703))
* i18n — sync language init, installer detection, new keys ([4898db0](https://github.com/xebjhm/SakaDesk/commit/4898db0c7a9b03a0405bb9941eb310e35f191645))
* landing page feature tags, i18n features section, text fixes ([5912374](https://github.com/xebjhm/SakaDesk/commit/59123745f46f1afce12e17674fccf0eb05949b44))
* **media-gallery:** jump to message via clickable timestamp ([ca8ca20](https://github.com/xebjhm/SakaDesk/commit/ca8ca203fb38493efeb651d0c3bb457c99849dc1))
* **models:** centralize model list with gemini-3.1, sync front/back ([387b864](https://github.com/xebjhm/SakaDesk/commit/387b864c7bb063f05814d2160fc29fe3a30a4407))
* **perf,cleanup:** simplify pass — memoization + dedup + async I/O ([6b5daea](https://github.com/xebjhm/SakaDesk/commit/6b5daeadc8a8d499bdfd7743ab7773b77d5afc8c))
* **persist:** move blog translation cache to backend app-state ([cad99ed](https://github.com/xebjhm/SakaDesk/commit/cad99edce419de5df3e7d3785582a964b538074e))
* **persist:** move language preference to backend app-state ([ac4f6d3](https://github.com/xebjhm/SakaDesk/commit/ac4f6d3ff23d4454c8d614331947b94a37a6633c))
* **persist:** move per-chat background to backend app-state ([69712ce](https://github.com/xebjhm/SakaDesk/commit/69712ce52f13a6dd8607ebdd0578ed84a1708650))
* **persist:** move per-room scroll position to backend app-state ([6bf65b4](https://github.com/xebjhm/SakaDesk/commit/6bf65b4a469caca89a8b9c113ab5688975aedb4e))
* **persist:** move read/unread state to backend app-state ([70c0713](https://github.com/xebjhm/SakaDesk/commit/70c0713b9c66845fc66a14f5902e0bfc483c22fb))
* **persist:** move ToS acceptance to backend app-state ([673dde5](https://github.com/xebjhm/SakaDesk/commit/673dde536b33b76976cd9a20271b344ed18742bb))
* **persist:** move volume + dismissed-update to backend app-state ([b7b3904](https://github.com/xebjhm/SakaDesk/commit/b7b3904410079cb445bf498f10617fa93183083e))
* **photo:** extract PhotoPlayer with bubble/gallery-thumb/fullscreen variants ([418640d](https://github.com/xebjhm/SakaDesk/commit/418640db2b5229625bf4ec3c1eb6cd8fc4e89bce))
* remove PriorityPool, use per-operation TCPConnector limits ([397fb88](https://github.com/xebjhm/SakaDesk/commit/397fb887b3c084d31c73cd013a0d395409d38566))
* rename groupThemes to serviceThemes and consolidate color system ([07d59ad](https://github.com/xebjhm/SakaDesk/commit/07d59ad2142dfe91642b179227a57d9c1d7f8c6c))
* **search:** batch MAX(message_id) query in incremental index ([aaf29dc](https://github.com/xebjhm/SakaDesk/commit/aaf29dca57f756e1b417b06eeb92e95cd5b2c0d1))
* **search:** move index builds to ProcessPoolExecutor for GIL-free CPU work ([c1e9f2a](https://github.com/xebjhm/SakaDesk/commit/c1e9f2a5e71ea941d2d4fa3e3cd8b261a7162ccb))
* **settings:** shared "AI Provider" block for transcription + translation ([7d2d9d1](https://github.com/xebjhm/SakaDesk/commit/7d2d9d1baf4bb2a68951acb3a08183a5e3514cf3))
* **sync:** batch check_new_messages by group ([75d61d2](https://github.com/xebjhm/SakaDesk/commit/75d61d2f5fca524ec77db2243961c5a5e8b954f5))
* **sync:** extract _authenticated_client for reuse by verify ([417ae52](https://github.com/xebjhm/SakaDesk/commit/417ae52d1dd1692297846aa02c31f2ad6fd6f059))
* **sync:** extract shared sync formatters from SyncModal and InlineSyncView ([48103ad](https://github.com/xebjhm/SakaDesk/commit/48103ad7c0b5cf859817f74339c0f3ca36e95072))
* **sync:** fetch group timeline once per group in Phase 2 ([53e9e4a](https://github.com/xebjhm/SakaDesk/commit/53e9e4ad16bd7574efd4f335b83f1046a2bc0064))
* **sync:** hardcode adaptive base to 10 min, decouple from setting ([af34395](https://github.com/xebjhm/SakaDesk/commit/af343959a8f0680876d4b747eeeb8fa348a7eaeb))
* **sync:** offload scan to thread; extract path + since_ts helpers ([c16ade7](https://github.com/xebjhm/SakaDesk/commit/c16ade7779388267dbc43a7566df0ffc12857e74))
* **sync:** refresh nickname only on first sync of each session ([90b8415](https://github.com/xebjhm/SakaDesk/commit/90b84158668ff9ec2eb6b903d8bf9236f5f4bad8))
* **sync:** relocate mark-room-read-remote to chat API, gate fetch client-side ([8adf882](https://github.com/xebjhm/SakaDesk/commit/8adf882b478ab53837ddaa597dd33951507adef5))
* **sync:** remove unused activity multiplier ([71e87ce](https://github.com/xebjhm/SakaDesk/commit/71e87ce60298aadf04e1e999027670613bb09bcb))
* **sync:** restore auth-flow log statements in _authenticated_client ([6b041b6](https://github.com/xebjhm/SakaDesk/commit/6b041b61503bca55c127253680dc224d76c6cf09))
* **sync:** skip full re-fetch when only some group members are unsynced ([65fe1f8](https://github.com/xebjhm/SakaDesk/commit/65fe1f80089daecf54131734ef5683ab474bd4d6))
* **tos:** replace acknowledgement list with official ToS excerpts ([65d296e](https://github.com/xebjhm/SakaDesk/commit/65d296e87764a8c5b185d3a5813d4bbea8f3bb26))
* **translation:** drop dead blog paths, unify provider error mapping ([6428dd6](https://github.com/xebjhm/SakaDesk/commit/6428dd6b53a34058f456832397557047b570c58c))
* **translation:** move translation cache to backend app-state (async) ([cf94d2d](https://github.com/xebjhm/SakaDesk/commit/cf94d2db070e5789ac16cbfc10214180d70544f5))
* unify app-level UI to blue-pink gradient theme ([a3a96d5](https://github.com/xebjhm/SakaDesk/commit/a3a96d5850a451a468b05300462fe2cf34b7de25))
* unify blog content construction with single source of truth ([82637c1](https://github.com/xebjhm/SakaDesk/commit/82637c103cdc3a215eeedfbd8d55e5ca2bbd4882))
* **upgrade:** code review cleanup ([ef87bba](https://github.com/xebjhm/SakaDesk/commit/ef87bba20b8660f9c0c5af6ab76c24668a6f5e2a))
* **video:** move loop/speed/download into three-dot menu ([e6e83af](https://github.com/xebjhm/SakaDesk/commit/e6e83af575c58b0deab14281193d670670d1ec09))
* **video:** unify VideoPlayer, own transcription for gallery/fullscreen ([8482979](https://github.com/xebjhm/SakaDesk/commit/84829791c46b9a5ed1539aacaa430858849edb0d))
* VoicePlayer with amplified volume, menu fixes, and viewer mode ([8e2d69c](https://github.com/xebjhm/SakaDesk/commit/8e2d69c14aae680d0fcabcb5bacef4a09cb018d4))
* **voice:** unify VoicePlayer, own transcription for gallery/fullscreen ([0353db7](https://github.com/xebjhm/SakaDesk/commit/0353db7349c9f2847632a6707c3223ebdcb4f183))
* **website:** replace screenshots with high-res WebP ([5d4cd96](https://github.com/xebjhm/SakaDesk/commit/5d4cd96d8959aaf6af4dce4230cc34034a685b2d))


### Security

* **upgrade:** harden download and install pipeline ([6185e9b](https://github.com/xebjhm/SakaDesk/commit/6185e9bf57f124dc0d19a623f681237d0e79fe75))


### Documentation

* add blog search implementation plan ([8c0e274](https://github.com/xebjhm/SakaDesk/commit/8c0e27410e253e8c04dd5d80965d9b2b84b151f2))
* add blog search integration design ([89aa9f2](https://github.com/xebjhm/SakaDesk/commit/89aa9f259387cb23e592ab5ee619d7fb89abbd06))
* add bugfix batch design spec ([7d0507d](https://github.com/xebjhm/SakaDesk/commit/7d0507df960a5cc91b6be31d67db48889577d9fb))
* add bugfix batch implementation plan ([6a39b70](https://github.com/xebjhm/SakaDesk/commit/6a39b7013ac7ea8e0adbac3ef1c90374f473695d))
* add clipboard copy implementation plan ([6085825](https://github.com/xebjhm/SakaDesk/commit/6085825545275763c81d5423fed979632dd33bf1))
* add design specs for clipboard copy, transcription, and translation ([e054c88](https://github.com/xebjhm/SakaDesk/commit/e054c88a1d0a7a30845ef59c90bfcddb3e50f6fb))
* add DOC_FORMATS spec, CLAUDE.md, align PR template ([e41e87b](https://github.com/xebjhm/SakaDesk/commit/e41e87ba215ebabac35bee9e7121da46971f318c))
* add first-launch flow + adaptive concurrency design ([80bab88](https://github.com/xebjhm/SakaDesk/commit/80bab88fd9e417c2083287de7f66f307839018e5))
* add media-completeness spec and implementation plan ([8ca6146](https://github.com/xebjhm/SakaDesk/commit/8ca61463f0c1177bb6850bb990a55292b689142e))
* add transcription implementation plan ([2fabd2b](https://github.com/xebjhm/SakaDesk/commit/2fabd2b87fdd6406497d7b2e7fa622bf0ad03d00))
* add translation implementation plan ([fda8ec2](https://github.com/xebjhm/SakaDesk/commit/fda8ec229a5b2bd00d6d7fdfb16d3fd3d7701cc7))
* add unified doc-formats design spec ([5d74179](https://github.com/xebjhm/SakaDesk/commit/5d74179440df3bd00f47a7610c96abc1fb1f8266))
* add unified doc-formats implementation plan ([92383aa](https://github.com/xebjhm/SakaDesk/commit/92383aaa0a14d89b23fab91de5a1fdfebf729704))
* **backend:** add class and method docstrings to SyncService ([d9b0588](https://github.com/xebjhm/SakaDesk/commit/d9b0588743b55ad1e8f4d58c1f706f20bfb15614))
* **changelog:** add user-facing entries for the review-fix batch ([4f455d3](https://github.com/xebjhm/SakaDesk/commit/4f455d33a77bb0cc581d9fd52723a3a17ec33fcf))
* **frontend:** add JSDoc to hooks and store with comprehensive tests ([ffabe1a](https://github.com/xebjhm/SakaDesk/commit/ffabe1a6009a79bb9208f4276dde41ff1c8d7324))
* note media-completeness fix and Verify & Fix feature ([75dade3](https://github.com/xebjhm/SakaDesk/commit/75dade36ab26432b3db9e5f3ba038e5f016a1ab4))
* **plan:** add blog photo gallery implementation plan ([8665964](https://github.com/xebjhm/SakaDesk/commit/86659641dafbf08b7e52ef215fa46b055c650553))
* **plan:** add poller result-forwarding step to Task 10 ([6e994cb](https://github.com/xebjhm/SakaDesk/commit/6e994cb24712e235820113ff26af68d414d9f879))
* **plan:** implementation plan for port-independent app state ([63ff326](https://github.com/xebjhm/SakaDesk/commit/63ff326ce67ba5286d7150fbd0a439eebdd65887))
* **plans:** add upgrade system redesign design doc ([6ab7292](https://github.com/xebjhm/SakaDesk/commit/6ab72922ff7f0c0afd274758593b63d59eef1856))
* **roadmap:** add opt-in two-way unread sync (validated, not built) ([bc908c4](https://github.com/xebjhm/SakaDesk/commit/bc908c44288c43f63f595ee0470960b94eb1d4cb))
* **roadmap:** add P3.25 refresh token login to bypass browser auth ([8040241](https://github.com/xebjhm/SakaDesk/commit/80402412b6569c1b8b3005a0701bd60a7f703acf))
* **roadmap:** archive completed items and trim to active work ([a078459](https://github.com/xebjhm/SakaDesk/commit/a0784593d742752253cf6ac17026ac73cc910008))
* **roadmap:** re-sync with codebase (2026-06-28 audit) ([e843fa0](https://github.com/xebjhm/SakaDesk/commit/e843fa078cae8a2c1d98f051a38dd2d74826aab3))
* **roadmap:** remove protocol/RE detail from mobile-auth entries ([1846629](https://github.com/xebjhm/SakaDesk/commit/184662989554adb70e8d931bbc1b94c7466040e1))
* **settings:** clarify auth_mode web/mobile header profiles ([f41b6f9](https://github.com/xebjhm/SakaDesk/commit/f41b6f973ca5984c3e1748f45e0accb5b12e8ea7))
* **spec:** add blog photo gallery design spec ([708f916](https://github.com/xebjhm/SakaDesk/commit/708f9168ba2187acd7b9220837f6f5e393a09713))
* **spec:** app-state store -&gt; SQLite; reuse existing scroll debounce ([ed3e5f4](https://github.com/xebjhm/SakaDesk/commit/ed3e5f4c72de0ccb8f9536693d6a789d1783066d))
* **spec:** port-independent app state + close-reopen safety ([e69fe6a](https://github.com/xebjhm/SakaDesk/commit/e69fe6ad440d3756c9416f3d69a4d3da91535ddf))
* update documentation for pysaka rename ([e5eb171](https://github.com/xebjhm/SakaDesk/commit/e5eb171209664657f416818097acc8dacad6e681))

## [Unreleased]

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

[Unreleased]: https://github.com/xebjhm/SakaDesk/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/xebjhm/SakaDesk/compare/v0.3.1...v0.3.2
[0.2.4]: https://github.com/xebjhm/SakaDesk/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/xebjhm/SakaDesk/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/xebjhm/SakaDesk/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/xebjhm/SakaDesk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xebjhm/SakaDesk/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xebjhm/SakaDesk/releases/tag/v0.1.0
