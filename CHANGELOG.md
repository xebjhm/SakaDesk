# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0](https://github.com/xebjhm/SakaDesk/compare/SakaDesk-v0.2.4...SakaDesk-v0.3.0) (2026-11-10)


### Added

* **about:** add the aurora hero and your-archive stats ([92882d3](https://github.com/xebjhm/SakaDesk/commit/92882d3279c989ac2fc7727178d45c36e221718b))
* **api:** add archive stats endpoint for the About dialog ([a08f633](https://github.com/xebjhm/SakaDesk/commit/a08f633472ffc43a6e8c4822b840c7334c96339a))
* **api:** serve sent letters and account avatars from the archive ([d5648f7](https://github.com/xebjhm/SakaDesk/commit/d5648f74863b65130cc3fae2832e69a4418d5f9d))
* **auth:** add a per-service single-flight refresh gate ([6a26406](https://github.com/xebjhm/SakaDesk/commit/6a264067980dadf04d7cafae17bfbea82c4a9d07))
* **auth:** alert once when a session needs a new login ([d4c9180](https://github.com/xebjhm/SakaDesk/commit/d4c91805f9d373e5450c22019c7e5b2d8f312f55))
* **auth:** renew expired tokens before reporting logged out ([28bcab7](https://github.com/xebjhm/SakaDesk/commit/28bcab77987891cbaef61fc2dede1079a1e71ee3))
* **blog:** D2b blog screens on the design system ([fccc57f](https://github.com/xebjhm/SakaDesk/commit/fccc57fcedba0315e63367d030f1596c55daec8c))
* **blog:** log blog loads, fade views and make Retry work ([686df76](https://github.com/xebjhm/SakaDesk/commit/686df7670bf07909a83ed43980c502f8c967cb7b))
* **blog:** move the blog dialogs onto Modal and drop BaseModal ([23ba2c4](https://github.com/xebjhm/SakaDesk/commit/23ba2c43067edade58820201699b81b33b4a72c3))
* **blog:** restyle the rail and older/newer pills, fix arrow keys ([9876963](https://github.com/xebjhm/SakaDesk/commit/987696318f4625aab05d355a31adc9ecda3afd38))
* **blog:** restyle the recent feed and cards on design tokens ([59f9e0e](https://github.com/xebjhm/SakaDesk/commit/59f9e0e6aa56c189c0c67fa33eb0364186374cdc))
* **blogs:** apply accent roles and lang ja to the reader ([20e08ac](https://github.com/xebjhm/SakaDesk/commit/20e08ac4acfb99adc2f2ef4e43ece706130c1d75))
* **blog:** set the reader at a readable width on design tokens ([809ab28](https://github.com/xebjhm/SakaDesk/commit/809ab28deb3b04b64e745e3b802ec4bc8f4476b9))
* **blogs:** restore dialog accents and mark member names ja ([f5357ec](https://github.com/xebjhm/SakaDesk/commit/f5357ec9fa4642473a5f31e1d9ae0bb2d7f8e9a9))
* **blogs:** restore the feed's orbs, glass header and card glow ([bb5f9cb](https://github.com/xebjhm/SakaDesk/commit/bb5f9cba62065d1bd3c8ec554c5fab7be80943c7))
* **calendar:** Japanese holidays, weekend colours and a year-month picker ([7154217](https://github.com/xebjhm/SakaDesk/commit/7154217e760780f541aefbd3cba897b11f8d5812))
* **call-popup:** create, show and destroy the popup with the app ([b5a982b](https://github.com/xebjhm/SakaDesk/commit/b5a982b88a1df26bdfd81fd841701e432b3757bd))
* **call-popup:** divert new voices to the popup during sync ([a324aa0](https://github.com/xebjhm/SakaDesk/commit/a324aa0075789c172ecdeeddd85cb2181f0acf8c))
* **call-popup:** host the popup in a no-activate desktop window ([2b65053](https://github.com/xebjhm/SakaDesk/commit/2b6505349f898680835ecc664bfccdb7da99a490))
* **call-popup:** mark popup-answered voices heard in the main window ([dd9725c](https://github.com/xebjhm/SakaDesk/commit/dd9725c476788256f6148d15d245053d04f077bf))
* **call-popup:** render the bottom-right popup call view ([4656613](https://github.com/xebjhm/SakaDesk/commit/46566133e78ae8f4f22d6b04cddc5cc137938b7c))
* **call-popup:** report call outcomes and skip calls the popup owns ([0d66dbc](https://github.com/xebjhm/SakaDesk/commit/0d66dbc58c2a033735c46d4acf7a6ff7f56b353b))
* **call-popup:** ring background voice messages in a corner call window ([0725cc3](https://github.com/xebjhm/SakaDesk/commit/0725cc30784c8f769ebbc960de6b3669c1e49dd3))
* **call:** take the call accent from the member's group scope ([61b4d1a](https://github.com/xebjhm/SakaDesk/commit/61b4d1a269495693c263d2bc956bff661bc89b1f))
* **chat:** add an instant, self-correcting timeline jump hook ([0a48810](https://github.com/xebjhm/SakaDesk/commit/0a488104bfe08878336290d81d6a27591ccce0f6))
* **chat:** add header avatar and streak, message runs, token bubbles ([25fd8e9](https://github.com/xebjhm/SakaDesk/commit/25fd8e9c0740403ef07c4a05641eed89c9a3e79b))
* **chat:** add the pure timeline model with runs and day groups ([85607a6](https://github.com/xebjhm/SakaDesk/commit/85607a6e22f894b709751c90a168d152caf2e4e1))
* **chat:** cache the member streak once per room per local day ([8e9d21a](https://github.com/xebjhm/SakaDesk/commit/8e9d21a37891f9a0bf6075536ac4e5424d692c87))
* **chat:** D2a chat frame, date pills and letters in chat ([32e622d](https://github.com/xebjhm/SakaDesk/commit/32e622d1dbba8add92ba0edc9bb887f2ddc1fc9f))
* **chat:** give the profile card accent pills and a Japanese name ([f6d6025](https://github.com/xebjhm/SakaDesk/commit/f6d60258ae858d23c91c8061811d95edb25e508c))
* **chat:** glide timeline jumps into place ([fc70f6d](https://github.com/xebjhm/SakaDesk/commit/fc70f6d7406f2b23ca364e7ce2d8f1c0385ab061))
* **chat:** group the timeline by day with sticky date pills ([78323bc](https://github.com/xebjhm/SakaDesk/commit/78323bc5ed762372e1a8796aa627b7bc43f0b678))
* **chat:** log dropped letters and letter avatars once per room ([d60dd0f](https://github.com/xebjhm/SakaDesk/commit/d60dd0f6fa5aa5120f71dcf6e4b6bdda27645964))
* **chat:** move calendar, background and favorites onto Modal ([0ee6df4](https://github.com/xebjhm/SakaDesk/commit/0ee6df493c20dca90c5f417f029af959620f92b8))
* **chat:** put bubbles, shelters and letters on accent tokens ([8209432](https://github.com/xebjhm/SakaDesk/commit/8209432529e0c0ca89afc9def825cde21d9a0510))
* **chat:** resolve timeline jump targets and landing error ([8e8b76b](https://github.com/xebjhm/SakaDesk/commit/8e8b76be595ada81be3f47929c12658590140611))
* **chat:** restore member list colours and the unread glow ([a556ca2](https://github.com/xebjhm/SakaDesk/commit/a556ca2831a7d176a256e9602abd346443429779))
* **chat:** restore the chat header pills and menu accents ([1374282](https://github.com/xebjhm/SakaDesk/commit/1374282b0dba3184734d81f607c70ca6855d86ba))
* **chat:** show sent letters in the timeline ([3b64af5](https://github.com/xebjhm/SakaDesk/commit/3b64af5c2cce81042b1ab3f7571d5f21c9dcdd97))
* **chat:** turn sent letters into an overview that jumps to the letter ([89f2966](https://github.com/xebjhm/SakaDesk/commit/89f296631ea7e91a3a73b07a1c107634d47b72d4))
* **design:** add a language switcher to the style page ([0de0087](https://github.com/xebjhm/SakaDesk/commit/0de008725628a68b6d6ed95cf69e3752bea59ade))
* **design:** add Badge, Avatar and DatePill primitives ([bdc896b](https://github.com/xebjhm/SakaDesk/commit/bdc896bbfd8850fbda772006501a8e9ba8fdc10c))
* **design:** add blog reading, mark, ambient and wash tokens ([c0ff564](https://github.com/xebjhm/SakaDesk/commit/c0ff5645f676fe3af2bd8c88d1489ff0c8754f8e))
* **design:** add brand ink, aurora and accent roles ([aa99c13](https://github.com/xebjhm/SakaDesk/commit/aa99c130ec8d715f610c027e0a6b466bdf8d7291))
* **design:** add brand scope for brand-context surfaces ([0c101bb](https://github.com/xebjhm/SakaDesk/commit/0c101bba75928b8034ff4f071f59026a01524c70))
* **design:** add Button, IconButton, RailItem and Modal ([874986a](https://github.com/xebjhm/SakaDesk/commit/874986af9f8d52ead50e8597270232e21fc854fc))
* **design:** add Canvas, Sheet, Card and Pill primitives ([19a8eaf](https://github.com/xebjhm/SakaDesk/commit/19a8eaf640f3a018709b3c30d31ad95846de06da))
* **design:** add chat header, shelter and accent mix tokens ([a18eaf8](https://github.com/xebjhm/SakaDesk/commit/a18eaf86504ba345ed6feb205c099f2ea007ddbd))
* **design:** add D2c status, viewer and decor tokens ([20e425d](https://github.com/xebjhm/SakaDesk/commit/20e425df89f6656dd16a38ecdb964d69da7dca56))
* **design:** add date-pill label and shared i18n keys ([bc2fd17](https://github.com/xebjhm/SakaDesk/commit/bc2fd17435910d55816db6166b3dc95d5f8bec89))
* **design:** add design tokens as the single source ([f4411de](https://github.com/xebjhm/SakaDesk/commit/f4411deb891617e31fbee8f35dd686615778ad7e))
* **design:** add design-system foundation ([0d2d950](https://github.com/xebjhm/SakaDesk/commit/0d2d950032ea401eff55336537a932e3c16c9637))
* **design:** add dev-only living style page ([d3c3c3d](https://github.com/xebjhm/SakaDesk/commit/d3c3c3d719125c0ff859e50b9da0ea5d0a0138be))
* **design:** add empty state, atmosphere and celebration primitives ([f19947d](https://github.com/xebjhm/SakaDesk/commit/f19947d1c5a0f21b77b463815853f08bddaee671))
* **design:** add glide and landing motion tokens ([8441381](https://github.com/xebjhm/SakaDesk/commit/844138136ac48852098fc182e4ffb7593b520441))
* **design:** add icon button shapes and the soft variant ([a123b0b](https://github.com/xebjhm/SakaDesk/commit/a123b0bd524f32611997115ffb2154db6f75f25f))
* **design:** add Menu, Switch, Input, Select and DialogStatus ([6e22f53](https://github.com/xebjhm/SakaDesk/commit/6e22f537326299f78415341ec81357e4f3a1a298))
* **design:** add progress role, logo ring and R-d breadcrumbs ([690932b](https://github.com/xebjhm/SakaDesk/commit/690932bda544c6a9621ca152abf368423a3ab73c))
* **design:** add Tailwind utilities for the group colour roles ([05ad47d](https://github.com/xebjhm/SakaDesk/commit/05ad47daeab4bb324f99c1a6e9a72167ae9910e5))
* **design:** add the design language v2 foundation ([9a8200f](https://github.com/xebjhm/SakaDesk/commit/9a8200f74df44e76324183fb32c99a7ac20ccd26))
* **design:** add the dialog layer behind the Modal primitive ([e524548](https://github.com/xebjhm/SakaDesk/commit/e5245487e70e1c47a4301559296031b0579ee315))
* **design:** add the tail radius and the group title gradient ([527aa11](https://github.com/xebjhm/SakaDesk/commit/527aa11a83c07a08a6afae412deab66c9fd63c54))
* **design:** add token Tailwind utilities and cn support ([2c272b9](https://github.com/xebjhm/SakaDesk/commit/2c272b91ff7b0ae9257d96a500d3e344d8bbedfb))
* **design:** add v2 button variants, loading and disabled reason ([9032db3](https://github.com/xebjhm/SakaDesk/commit/9032db36ecc705d23ddd79556833841a5bc0c054))
* **design:** bold dialog titles, header icons, group marker hook ([436a3ab](https://github.com/xebjhm/SakaDesk/commit/436a3abb007da4aaea1033228db90dc0fd94719f))
* **design:** give menu items a reasoned disabled state ([41db72d](https://github.com/xebjhm/SakaDesk/commit/41db72de38b9bd3267ae468903a056e7d03dd7bd))
* **design:** let dialogs inherit the brand scope ([088ac1b](https://github.com/xebjhm/SakaDesk/commit/088ac1b0851d7cea2c6992f1a8a1c83c8b3ce844))
* **design:** merge status colours into one semantic set ([d59907a](https://github.com/xebjhm/SakaDesk/commit/d59907a010c8783e6bf6992560b996900ce72ebb))
* **design:** pick font glyphs by UI language, add display size ([4b962a1](https://github.com/xebjhm/SakaDesk/commit/4b962a13be2dee86836193face9f1299dc1bba01))
* **design:** re-base Yodel colours on its logo periwinkle ([84fcad4](https://github.com/xebjhm/SakaDesk/commit/84fcad4f0ad8cee68f465c3a9de6c470d63776d8))
* **design:** restore expressive dialog headers, add brand scope ([e06fe37](https://github.com/xebjhm/SakaDesk/commit/e06fe37d51bd1ccd43e518807f60d76305bc1d1c))
* **design:** show group scales and the role map on the style page ([ed11a3f](https://github.com/xebjhm/SakaDesk/commit/ed11a3f7058bd18bf018379e1b43a474d7a6dde5))
* **design:** show v2 contexts and primitives on the style page ([d3cc504](https://github.com/xebjhm/SakaDesk/commit/d3cc50437856309b9808f2cb053d5250ffdc0048))
* **design:** switch groups to the unified two-layer colour system ([06f7306](https://github.com/xebjhm/SakaDesk/commit/06f7306618509e336ec80a7df410b5190a446c43))
* **design:** switch to the six-step radius scale ([bc35163](https://github.com/xebjhm/SakaDesk/commit/bc351638254d33225f71dfe804f5bcc793732af4))
* **design:** unify group colours into a two-layer system ([8d3588a](https://github.com/xebjhm/SakaDesk/commit/8d3588af30dc68f42c54eb710d902ea5ba033047))
* **design:** write tokens to CSS variables with breadcrumbs ([87792ef](https://github.com/xebjhm/SakaDesk/commit/87792effd939e705c97a7fc5508d699ba71a9e85))
* **desktop:** badge the tray and open login from the toast ([caec084](https://github.com/xebjhm/SakaDesk/commit/caec084fb19144382b78f33aede033af1a979c79))
* **desktop:** match the Windows title bar to the app colour ([d91422d](https://github.com/xebjhm/SakaDesk/commit/d91422da61390c359179ad074b91e7beda5ba731))
* **diagnostics:** give the hidden panel a dark console look ([f1f76d1](https://github.com/xebjhm/SakaDesk/commit/f1f76d1a614215bdc6a0aa2faa2b9662abe5e006))
* **dialogs:** brand add service and search with group markers ([e2859b7](https://github.com/xebjhm/SakaDesk/commit/e2859b7ad533cc90072f5704bc9d254ba87a1dd8))
* **dialogs:** brand scope and colour for app dialogs and confirm ([11257f5](https://github.com/xebjhm/SakaDesk/commit/11257f565a847187a627054bdae8f2f1351a823e))
* **dialogs:** re-apply design language v2 to dialogs ([b0b71c5](https://github.com/xebjhm/SakaDesk/commit/b0b71c59057a1c2be2bcdb0b789999f388019cf6))
* **dialogs:** restore chat dialog accents and the yellow star ([f3b589a](https://github.com/xebjhm/SakaDesk/commit/f3b589ac828ef1b6877277479eb0045f861f0e6e))
* **entry:** celebrate the first complete sync with a toast ([22dcde2](https://github.com/xebjhm/SakaDesk/commit/22dcde2dd6fb9a23ee6492cb244f3682887d61da))
* **entry:** make setup a brand form that validates on click ([ae009b2](https://github.com/xebjhm/SakaDesk/commit/ae009b221582e4d78d6b947b5d455a5e5958500d))
* **entry:** put boot and ToS on the brand with group links ([b524859](https://github.com/xebjhm/SakaDesk/commit/b524859471663c1abc6f61d7969fd1fcd2ce746c))
* **entry:** re-apply design language v2 to entry and brand moments ([5113ae4](https://github.com/xebjhm/SakaDesk/commit/5113ae4c64a341c71ed8c6aa1eb893584e128a28))
* **entry:** restore landing group cards as group markers ([4c6c64c](https://github.com/xebjhm/SakaDesk/commit/4c6c64c958e17bc6d361ca3ca2a7c1cb03b0e248))
* **frontend:** draw empty states with the brand-moment pattern ([9fc4d6e](https://github.com/xebjhm/SakaDesk/commit/9fc4d6e1a8473cda56b8333c0c0fd7c30654589c))
* **layout:** put rails and content on the canvas and sheet frame ([4dcd09a](https://github.com/xebjhm/SakaDesk/commit/4dcd09acaa474c9115e9597949bb7b377743ddca))
* **letters:** open sent letters in a viewer with full text ([9293c58](https://github.com/xebjhm/SakaDesk/commit/9293c58b7fbf1bb76077c4b45c0a5303fe27bef7))
* **letters:** show the number of sent letters in the overview ([ecd3696](https://github.com/xebjhm/SakaDesk/commit/ecd3696b575c5f1279018821ca1bbdecd2fcd563))
* **log:** accept timeline jump breadcrumbs ([b4395a4](https://github.com/xebjhm/SakaDesk/commit/b4395a46bfd03aab65883bbe03dfafd80d5c1c70))
* **media:** let player and transcript accents follow the context ([a1e2e60](https://github.com/xebjhm/SakaDesk/commit/a1e2e6022f80d1f2e91885c30f9e86fc875d8967))
* **media:** put viewers, gallery and player menus on tokens ([b1b2abe](https://github.com/xebjhm/SakaDesk/commit/b1b2abe7bec8872d49e3fa0cf78b56e4b4a4746a))
* **media:** restore gallery accents and mark names ja ([43b628e](https://github.com/xebjhm/SakaDesk/commit/43b628ecda44794d2ac7409c3d6b22d9867f73dd))
* **media:** serve resized archived avatars ([6a38054](https://github.com/xebjhm/SakaDesk/commit/6a380547e573475ee09349a48688df62959159e6))
* **media:** zoom photos in the gallery detail view ([f63c310](https://github.com/xebjhm/SakaDesk/commit/f63c310fee36314a97dc17f83768fb40bf1b69ae))
* **media:** zoom with the wheel and drag to pan in the viewer ([ada4d55](https://github.com/xebjhm/SakaDesk/commit/ada4d55217d8eb0a99652922eb7ebe71ce4cf94b))
* **messages:** celebrate message and subscription milestones ([cfb995c](https://github.com/xebjhm/SakaDesk/commit/cfb995cfe93bc1ff08d0a895872148efe57df43f))
* **notify:** exact new-message counts and Windows toasts ([ee67748](https://github.com/xebjhm/SakaDesk/commit/ee6774817273652badbbf58c8a47ca0ca1bfcd93))
* **notify:** open the chat at the notified message ([688769f](https://github.com/xebjhm/SakaDesk/commit/688769ffbcd3f9937a5c8d5895d99187ee519225))
* **rail:** show feature rail as icons with hover tooltips ([43765a9](https://github.com/xebjhm/SakaDesk/commit/43765a9c29ce6e3b4fd1ca8a0db751c5bc40b77a))
* **search:** move search onto a top-placed Modal with mark tokens ([053d307](https://github.com/xebjhm/SakaDesk/commit/053d30708686aadfcace8540b0f1d117eb5d3f42))
* **settings:** add the background call popup toggle ([ab9257d](https://github.com/xebjhm/SakaDesk/commit/ab9257db2e02cbc4cc6778f3d584e6b208e456bf))
* **settings:** brand settings with group-marked sync rows ([6ab0b09](https://github.com/xebjhm/SakaDesk/commit/6ab0b091d3396729d6a1efb298a71b1cfe0fa657))
* **settings:** restyle settings on Modal, Switch and in-app confirms ([e3ba88b](https://github.com/xebjhm/SakaDesk/commit/e3ba88b78e5b1a3c9d2bfa8dab90d24189e621b4))
* **sidebar:** restyle the member grid with avatars, badges and pills ([31d0212](https://github.com/xebjhm/SakaDesk/commit/31d0212dc3fdebb42e164d08ac175727a2613049))
* **sync:** brand sync dialog with group-marker steps and warnings ([5c64712](https://github.com/xebjhm/SakaDesk/commit/5c64712fb18843b06a35de6cbf213a062f64868d))
* **sync:** download backfill and letter media in phase 3 ([3193a75](https://github.com/xebjhm/SakaDesk/commit/3193a75de42cf729b4a2a765e15f710f85caac9a))
* **sync:** gate token refreshes and report dead sessions ([483150e](https://github.com/xebjhm/SakaDesk/commit/483150e2422405e25c3abfa51241b042dbb0bd9e))
* **sync:** one backend sync queue with honest progress ([9007d8a](https://github.com/xebjhm/SakaDesk/commit/9007d8a5bcb052f6fcc0b6ac9c57c6c5988f0183))
* **sync:** put the sync dialog and inline sync on the design system ([c663739](https://github.com/xebjhm/SakaDesk/commit/c66373970a8530640d68b40403cdd1bf1adcf9b7))
* **sync:** report honest progress and ETA ([ce5456c](https://github.com/xebjhm/SakaDesk/commit/ce5456c780990ca7dc7b8020f99381ab7df2f686))
* **sync:** run every sync through one backend queue ([c043536](https://github.com/xebjhm/SakaDesk/commit/c043536a1aba39e04ebd1fe3ae2847699efee79c))
* **sync:** show the backend sync queue in the dialog ([479fee0](https://github.com/xebjhm/SakaDesk/commit/479fee0893c34ff6280c0052ba04cdc25017a4a0))
* **tray:** keep SakaDesk running in the tray with background sync ([cb4949b](https://github.com/xebjhm/SakaDesk/commit/cb4949b8726a953e90952a1cefc70269ed792892))
* **ui:** acceptance round 3 and reliable media playback ([2dd8836](https://github.com/xebjhm/SakaDesk/commit/2dd8836ff4449e4b3521d78754e679f1d7839045))
* **ui:** add frost, oshi and star tokens, accent Pill, blog_fallback ([1274095](https://github.com/xebjhm/SakaDesk/commit/127409517b7e3da7cb9ad785a84039ca68b07c6f))
* **ui:** add the window token, group scope and neutral entry tokens ([2713961](https://github.com/xebjhm/SakaDesk/commit/2713961d2aea90c92bc4df054467dc175bf76b35))
* **ui:** bring the group colour back to the feature rail ([bb66be9](https://github.com/xebjhm/SakaDesk/commit/bb66be9e1e9d795ceba68c43b0ac94381d5e2c3f))
* **ui:** D2c dialogs, viewers and menus on the design system ([5ce94b1](https://github.com/xebjhm/SakaDesk/commit/5ce94b12e51e66bf3d116e6261db8b63de052c44))
* **ui:** give the group rail brand-ink actions ([cd2f183](https://github.com/xebjhm/SakaDesk/commit/cd2f183aafd313b2c67449c4f8f9152129dd4268))
* **ui:** move about, report, diagnostics and confirms onto Modal ([c4d5699](https://github.com/xebjhm/SakaDesk/commit/c4d5699bb6ebe35d7902fa239079578c6d92b337))
* **ui:** move menus and profile card onto Menu and Modal ([0e959e6](https://github.com/xebjhm/SakaDesk/commit/0e959e6d09f4a47eaa9f05040b6bc6b3688a57ba))
* **ui:** put the landing page, boot screen and error toast on tokens ([46e3c05](https://github.com/xebjhm/SakaDesk/commit/46e3c0528b8c9f0906d5f2c087e7ee9004a47444))
* **ui:** put the ToS, setup and login dialogs on the design system ([05fc12b](https://github.com/xebjhm/SakaDesk/commit/05fc12bf4d7bc7e91d742c1cf38e90c15bf5f096))
* **ui:** re-apply design v2 to the blog screens ([fd00fae](https://github.com/xebjhm/SakaDesk/commit/fd00fae914bcf96ef8e70d2312a9a6b54da556ef))
* **ui:** re-apply design v2 to the frame and chat ([4b52636](https://github.com/xebjhm/SakaDesk/commit/4b52636ec6fbec0a2b13b18113fb993afdce5b38))
* **ui:** restyle the entry screens and layer calls above dialogs ([7cbd14e](https://github.com/xebjhm/SakaDesk/commit/7cbd14e17a5812255898281b16f8226c00c35539))
* **ui:** slim styled scrollbars ([533fbf1](https://github.com/xebjhm/SakaDesk/commit/533fbf17388d98d946eff609ed4995de7468a5a1))
* **updates:** download and install from Settings → Updates ([4b34f6f](https://github.com/xebjhm/SakaDesk/commit/4b34f6fe6ead8bcc53813ab1191186c5ad01712d))
* **updates:** download and install from Settings → Updates ([71ecb9f](https://github.com/xebjhm/SakaDesk/commit/71ecb9fbd4f367e2767e4c4f4a4e231afe02db38))


### Fixed

* address R-f final review ([e9676c3](https://github.com/xebjhm/SakaDesk/commit/e9676c31f7530989e1a730953723d78d446a8653))
* address R-g final review ([2e65fd9](https://github.com/xebjhm/SakaDesk/commit/2e65fd9d3ca2c18e29d019eef86f79d754d085f6))
* address R-g review minors ([f02fb7c](https://github.com/xebjhm/SakaDesk/commit/f02fb7c4bc5fc0b1517126e956f28e2151b00d7f))
* address R-h final review ([f202014](https://github.com/xebjhm/SakaDesk/commit/f20201405ca62574c6899bf2a82dd2544bcbeb22))
* address R-h review minors ([973bda7](https://github.com/xebjhm/SakaDesk/commit/973bda70cf75f1b0067b3ffa91174cd6d323c8c2))
* **api:** harden archive reads and log rejected letter paths ([7971384](https://github.com/xebjhm/SakaDesk/commit/79713847fca5f43a826f555e3a0da66ea2f6acbf))
* **api:** reject unresolvable letter paths and count bad images ([2712005](https://github.com/xebjhm/SakaDesk/commit/2712005da394eaad11e8b7dd52478ac63bc77d6c))
* **app:** harden translation batching and its tests ([8f27656](https://github.com/xebjhm/SakaDesk/commit/8f27656c0b8e7394be16d27acf7b9d6dbc0097ca))
* **app:** treat a failed translation cache read as a miss ([d16ab3e](https://github.com/xebjhm/SakaDesk/commit/d16ab3e2d0ff906db4893021b19b250638a8e8c6))
* **auth:** harden renewal (skew, keyring, logout) and cover branches ([5deeb6f](https://github.com/xebjhm/SakaDesk/commit/5deeb6f736f2a34cc36a5c37ace39141d33b62cc))
* **auth:** keep a timed-out status renewal running to save ([816cecf](https://github.com/xebjhm/SakaDesk/commit/816cecf7f02fb82e5372c4352800b0353836f64d))
* **auth:** log gate timeouts and never leak the lock ([ac10240](https://github.com/xebjhm/SakaDesk/commit/ac1024095186a9e0c8dacc12ae367d7b3cbb9bc7))
* **auth:** retry marked sessions and bound status renewal ([0b2512b](https://github.com/xebjhm/SakaDesk/commit/0b2512b4801ea960da35db4e6fb98718c573e76d))
* **backend:** serve fixture archive stats in test mode ([b054a75](https://github.com/xebjhm/SakaDesk/commit/b054a756ac678baea5842563f2e017ec69696500))
* **blog:** group-coloured feed title and stronger orb 1 wash ([5c7a0ea](https://github.com/xebjhm/SakaDesk/commit/5c7a0ea333071865a4b1ababa3d70047ceee9042))
* **blog:** hide the gallery count while loading; spaced heart names ([412b145](https://github.com/xebjhm/SakaDesk/commit/412b1456e346b75449e8772d8538ae8d52ffba0a))
* **blog:** keep ← / → from switching posts under a dialog ([6d276b2](https://github.com/xebjhm/SakaDesk/commit/6d276b210a3d3fb49c1221e7222b4db0a538d879))
* **blog:** keep the rail lens centre in state and ease its fade out ([4e8bf67](https://github.com/xebjhm/SakaDesk/commit/4e8bf67e2f8f44531cde3ba56dc5277f37d03f8b))
* **blog:** restore the original feed tile with its floating caption ([ce03f0a](https://github.com/xebjhm/SakaDesk/commit/ce03f0a19fc9d38484fac17cdd41ed4a8dc4c5aa))
* **blog:** restore the original feed tile, filter and rail light ([a936ddc](https://github.com/xebjhm/SakaDesk/commit/a936ddc8c9717ef4333897577b897797e9503c57))
* **blog:** restore the single All / Favorite segmented control ([865e9b5](https://github.com/xebjhm/SakaDesk/commit/865e9b55eae5b7550f8766d414da06e09129b0f6))
* **blog:** restore the timeline rail lens glow over the zoomed zone ([f2f03af](https://github.com/xebjhm/SakaDesk/commit/f2f03af790fa743600b2541ebea62a65f847888d))
* **blog:** spring only the caption nudge and keep tiles still ([f299f25](https://github.com/xebjhm/SakaDesk/commit/f299f25946a09410f4806e0afb03fa785241065a))
* **blogs:** resized member thumbnails in the member picker ([a310298](https://github.com/xebjhm/SakaDesk/commit/a310298c55263559525f8b37546d1a8b5ef6bb39))
* **blogs:** restore feed title, member buttons and glass ([7c572b0](https://github.com/xebjhm/SakaDesk/commit/7c572b0cfc33200ae4dafc0a34824256437e6ee8))
* **blogs:** restore the member timeline's plain header ([a8efa32](https://github.com/xebjhm/SakaDesk/commit/a8efa32b0f428ab8448121086e0eddec82d88d5a))
* **build:** never package a stale frontend after a failed build ([8037f28](https://github.com/xebjhm/SakaDesk/commit/8037f28af4b5251e416a89982a521f54511c6aac))
* **build:** never package a stale frontend after a failed build ([28dd63e](https://github.com/xebjhm/SakaDesk/commit/28dd63ee2e3129434c7243cffba8f20554c0847e))
* **calendar:** translate the day item count and drop dead strings ([eb12e77](https://github.com/xebjhm/SakaDesk/commit/eb12e778c28a725dc63aacf556e11227daa0c627))
* **call-popup:** accept a start that arrives before the page mounts ([bab8846](https://github.com/xebjhm/SakaDesk/commit/bab88469bdbd736242b6db736aa9d7de255cb327))
* **call-popup:** answer ui-state without waiting on the popup ([8a1b785](https://github.com/xebjhm/SakaDesk/commit/8a1b785951c0470b4dad6052e17f01c67d61ca8a))
* **call-popup:** bound the popup destroy and harden reveal ([6df932e](https://github.com/xebjhm/SakaDesk/commit/6df932e40d9537d9afd650e45aca734ac91c1fa7))
* **call-popup:** drop the dark frame around the call card ([01d8002](https://github.com/xebjhm/SakaDesk/commit/01d8002a0779f6f95ed1388b27047a17cd6f07e6))
* **call-popup:** ignore malformed heard requests safely ([e2aa191](https://github.com/xebjhm/SakaDesk/commit/e2aa19168caa864f67ffae423e133584ff5c2b16))
* **call-popup:** keep toasts and end reasons on every path ([678f0a3](https://github.com/xebjhm/SakaDesk/commit/678f0a325fd64a160d86833b37d36fdfd7057156))
* **call-popup:** log failed popup checks in the main window ([3bfa11c](https://github.com/xebjhm/SakaDesk/commit/3bfa11ca465e19f57445446f443a2de74d387092))
* **call-popup:** never leak a reserved call on cancel ([fffced6](https://github.com/xebjhm/SakaDesk/commit/fffced60b64d3900a607377bec65219e2b230263))
* **call-popup:** never leave a revealed popup after a cancel ([df0cd6e](https://github.com/xebjhm/SakaDesk/commit/df0cd6ef9075d7a9e411aa96ba7847dbdb91ac68))
* **call-popup:** preload the voice without an audio element ([57678fa](https://github.com/xebjhm/SakaDesk/commit/57678fac953075f919270a51c3e2f5adb21c046d))
* **call-popup:** re-arm the start watchdog after start returns ([41e928b](https://github.com/xebjhm/SakaDesk/commit/41e928ba471254fee9ac47371ee9afa65fcb0b48))
* **call-popup:** run host calls on their own executor ([695d7db](https://github.com/xebjhm/SakaDesk/commit/695d7dbc98c7baff17e2355149d178e8c9d9bf2e))
* **call-popup:** transparent window keeps the 16px card corners ([8bf47dd](https://github.com/xebjhm/SakaDesk/commit/8bf47dd0b5a60722a065cbe44c34e02294cdab73))
* **call-popup:** wait for the conversation cache before marking heard ([4947a8b](https://github.com/xebjhm/SakaDesk/commit/4947a8b7f5758035dfbee61d888db267d2018424))
* **call:** clip call card corners and draw one edge line ([0ab6648](https://github.com/xebjhm/SakaDesk/commit/0ab66480684e75631cdde41b9480037806284461))
* **call:** log the focus hand-back of a lifted call ([0262357](https://github.com/xebjhm/SakaDesk/commit/02623576fe63f4f4c33157ec49c24f5c0764c66f))
* **call:** log the kept focus breadcrumb only when a call goes away ([b88ac7e](https://github.com/xebjhm/SakaDesk/commit/b88ac7e414339ff0857f542cf530a0310717c479))
* **call:** show a call that rings over an open dialog above it ([a0c0681](https://github.com/xebjhm/SakaDesk/commit/a0c06818701324c6ca549969a71afc01dffcac23))
* **call:** use the group action colour for the call accent ([bf86919](https://github.com/xebjhm/SakaDesk/commit/bf8691949982ce26e41c446f6d6b492444e39f33))
* **chat:** ask letters and streak only for the service's own room ([5629dfe](https://github.com/xebjhm/SakaDesk/commit/5629dfecbf36a98e8a00d39355593e8598e017a6))
* **chat:** ask to reveal all with the in-app ConfirmDialog ([d250789](https://github.com/xebjhm/SakaDesk/commit/d2507897705d797906dea9b10e8eece56fa1a1a6))
* **chat:** cancel jumps on room switch or removed row, ignore key repeat ([41f91d1](https://github.com/xebjhm/SakaDesk/commit/41f91d114de20621eadfededd1eced3685a09a39))
* **chat:** darker message links ([60eefdf](https://github.com/xebjhm/SakaDesk/commit/60eefdfba9cbeeecdc11ba3a61c2c4c62a328c18))
* **chat:** drop a scroll range reported by the previous room ([0d11444](https://github.com/xebjhm/SakaDesk/commit/0d11444a7f8c2bd23e3edf016d1378920cf9d1ee))
* **chat:** join the transcript footer to the voice bubble ([808c37e](https://github.com/xebjhm/SakaDesk/commit/808c37ebe43db9bc0904a3506dc8d12ed38d85b9))
* **chat:** keep a late letters answer out of the open room ([fbdf485](https://github.com/xebjhm/SakaDesk/commit/fbdf48590012025c7104641f185ecbfdf6de7f14))
* **chat:** keep the date pill above covers and clear of tools ([8ceef76](https://github.com/xebjhm/SakaDesk/commit/8ceef7675c1c9bd4bb3f1fce8b928b20bce7a980))
* **chat:** keep the header menu icon visible on hover ([73fa63c](https://github.com/xebjhm/SakaDesk/commit/73fa63cf42a5e07c71252748fdd5e70b3052ad29))
* **chat:** keep the translate icon focusable and out of the flow ([dc13eaf](https://github.com/xebjhm/SakaDesk/commit/dc13eafe64e073f98e78c72297e4dc350c276aec))
* **chat:** let clicks pass through the sticky date band ([05798e3](https://github.com/xebjhm/SakaDesk/commit/05798e342fdc33012f3b1526b7b59b5b30c47b9a))
* **chat:** log jump path, treat unknown range as instant, widen stillness ([1d0e5ef](https://github.com/xebjhm/SakaDesk/commit/1d0e5ef63a4f9f5965167207a1e108b62fffd2ca))
* **chat:** make calendar and message jumps instant ([e4e4118](https://github.com/xebjhm/SakaDesk/commit/e4e4118d3adabf84be5542132f3d2e51453e4059))
* **chat:** make calendar and message jumps instant ([c9669c3](https://github.com/xebjhm/SakaDesk/commit/c9669c363a2725919914f6be5de6622d1d9d6351))
* **chat:** match the voice player to the bubble's tail corner ([a21c42d](https://github.com/xebjhm/SakaDesk/commit/a21c42d87d8dd33d173f22fda9d488a5956b25d8))
* **chat:** name letters by date and show overview load states ([d6fcfa6](https://github.com/xebjhm/SakaDesk/commit/d6fcfa6fe4456240ca6a222e6b4d05618bec7b9f))
* **chat:** name the message context menu Message actions ([3d18013](https://github.com/xebjhm/SakaDesk/commit/3d180136a87f32e95864dc7f85984c2bfe5333db))
* **chat:** one translate icon beside the time and a neutral transcript control ([b4a46a8](https://github.com/xebjhm/SakaDesk/commit/b4a46a882c9eb7e80373e04618f24ee2c6647819))
* **chat:** re-resolve jump corrections by message id ([6879e7a](https://github.com/xebjhm/SakaDesk/commit/6879e7ab62d1a5f43cdc7c65b8b36e454dd54674))
* **chat:** resolve a scroll range only once its room owns the saves ([905f766](https://github.com/xebjhm/SakaDesk/commit/905f7665f4203081ee4dee69af66c943a1f1b7b0))
* **chat:** round avatar focus ring and neutral header focus ([9333084](https://github.com/xebjhm/SakaDesk/commit/9333084fb035af728b183258c03d64f9dc34393d))
* **chat:** show header pills on white headers; skip group streaks ([194d805](https://github.com/xebjhm/SakaDesk/commit/194d805b72f57e5d90da45af3875a491b078f448))
* **chat:** skip rows behind the date header in unread nav ([b673418](https://github.com/xebjhm/SakaDesk/commit/b6734180b537fbef59677d5ebeffcce1b70fa5c2))
* **chat:** snap a far jump whose glide ends short of the row ([a6765ed](https://github.com/xebjhm/SakaDesk/commit/a6765ed9d693fb4381e4b0b77e7d6a0570f6fb7b))
* **chat:** use the action token for the star; drop bubbleBorder ([d3a4d7c](https://github.com/xebjhm/SakaDesk/commit/d3a4d7c7461db3e58e1104c8c9c579823a96a0ce))
* **design:** address R-e final review ([65ce766](https://github.com/xebjhm/SakaDesk/commit/65ce766b5506d95df0ef7446756d60e250381032))
* **design:** ban 2xl radii and restore grown chat corners ([537718c](https://github.com/xebjhm/SakaDesk/commit/537718c8927c32503245c1e91fecf5e7e147a6c2))
* **design:** centre the button spinner without transforms ([679f231](https://github.com/xebjhm/SakaDesk/commit/679f23192514a1b6e08ad1eceb5fa852e8b17a41))
* **design:** clear Menu lint warnings ([64e5ae3](https://github.com/xebjhm/SakaDesk/commit/64e5ae3dc2d2c595b839d1cd02ca5f9d21365806))
* **design:** harden Menu Escape, Switch and the style-page demo ([d02a56d](https://github.com/xebjhm/SakaDesk/commit/d02a56d3259b9f6969ebade7fd73375e288142e5))
* **design:** keep button width while loading, mute disabled states ([34e418a](https://github.com/xebjhm/SakaDesk/commit/34e418ad826b73e13f600fd621a9133a6e00defd))
* **design:** keep dialog Tab order in DOM order, skip modified Tab ([aa64a01](https://github.com/xebjhm/SakaDesk/commit/aa64a0130319a75cd4afe2729a8d6e9dcf59b745))
* **design:** keep group focus ring on Pill ([54255a7](https://github.com/xebjhm/SakaDesk/commit/54255a7d28114e42f56c5c29dd91acfe2fe1bc6e))
* **design:** keep serif faces on Japanese content ([d327394](https://github.com/xebjhm/SakaDesk/commit/d32739467027f8a59b1844a0087df80aceef3b30))
* **design:** keep the selection halo shape, tidy v2 docs ([d3a46a2](https://github.com/xebjhm/SakaDesk/commit/d3a46a2bbd5d57ed6ab984ebda01cbc0fce1bb64))
* **design:** keep Yodel unread covers on the logo palette ([bfb5344](https://github.com/xebjhm/SakaDesk/commit/bfb53448ae9c41d1771cfcfcc97f874e7a51c926))
* **design:** listen for Escape in the layout phase with the push ([3be1d62](https://github.com/xebjhm/SakaDesk/commit/3be1d621072838313a8974518e072bf53b3a1b83))
* **design:** make ghost buttons neutral and document accent rule ([ade7962](https://github.com/xebjhm/SakaDesk/commit/ade7962ec056af565bd70e4d33c1bb48a6173e28))
* **design:** make the guard's comment stripping string-aware ([f75eb0f](https://github.com/xebjhm/SakaDesk/commit/f75eb0f22caabd6077575def023d5f72f6f63c8d))
* **design:** merge group gradient classes correctly in cn ([dd50022](https://github.com/xebjhm/SakaDesk/commit/dd50022b542b0a09b13e9c572eaa8c940ff6cf1b))
* **design:** restore Yodel's official unread shelter colours ([4d047f4](https://github.com/xebjhm/SakaDesk/commit/4d047f4ef1ce77c6bc519b3484cebc769f229262))
* **design:** restrain group colour to identity, state and primary ([da6e8d4](https://github.com/xebjhm/SakaDesk/commit/da6e8d48efd0badf25e791e4e8f622f6466a902e))
* **design:** scope Japanese content fonts to marked subtrees ([f99c5ac](https://github.com/xebjhm/SakaDesk/commit/f99c5acec9267470ec3d1269c192644157d23c94))
* **design:** scope the style page dialog to the chosen context ([3e92c26](https://github.com/xebjhm/SakaDesk/commit/3e92c26525f890f5843239c25efb997138c40e9a))
* **design:** settle dialog focus after commit and guard the Tab trap ([387c5c1](https://github.com/xebjhm/SakaDesk/commit/387c5c127ec5d0f9b4780853591d5d5a2d92c8b3))
* **design:** stack dialogs that open in one render by render order ([1c02c50](https://github.com/xebjhm/SakaDesk/commit/1c02c503a9ea8ad6eaa7c54a9b5f1bbf2e9d043d))
* **design:** teach class merging the v2 token utilities ([9f668a1](https://github.com/xebjhm/SakaDesk/commit/9f668a111f1a2f602b366342ba147724edb8976a))
* **design:** tidy v2 docs, button and confetti details ([7c826d7](https://github.com/xebjhm/SakaDesk/commit/7c826d7e97aff0a4e8a04206d1862ca6b1b0f25b))
* **design:** time the toast entrance and let sparkles show ([8035b48](https://github.com/xebjhm/SakaDesk/commit/8035b481ce6807c0e2be763e46bf5adec349d765))
* **design:** use a scrim token for the modal backdrop ([9823c0c](https://github.com/xebjhm/SakaDesk/commit/9823c0c4ae81c96e36b0df210831fdc7e261f685))
* **diagnostics:** divide the footer from the scrolling body ([2893eaa](https://github.com/xebjhm/SakaDesk/commit/2893eaac6e314c27f983b1d59b9709b08586b277))
* **diagnostics:** reword a comment the dialog style guard misread ([f8ab34e](https://github.com/xebjhm/SakaDesk/commit/f8ab34e93ab6680bcbf8693acc96adfdec07122c))
* **favorites:** clearer video placeholders that load on scroll ([ee1eddf](https://github.com/xebjhm/SakaDesk/commit/ee1eddfbe5ed4f92fc26ca18b3476605c5b17917))
* **favorites:** show a placeholder while videos load ([5ba99ef](https://github.com/xebjhm/SakaDesk/commit/5ba99efd7f9e2a45877a516b988d7e9c706274b7))
* **frontend:** add a warning button variant so warning confirms stay amber ([c2ca48f](https://github.com/xebjhm/SakaDesk/commit/c2ca48f25284e7f3debd783e235c18b5a3b9990e))
* **frontend:** darken compact voice player button hover ([8c1b521](https://github.com/xebjhm/SakaDesk/commit/8c1b52124fedec1fea03e352785bdc98ee7ce04f))
* **frontend:** keep calendar focus visible on today, restore diagnostics icon, mark member sublabel as ja ([c70523e](https://github.com/xebjhm/SakaDesk/commit/c70523e944d4c27bb8692b8efef10c760182cf1c))
* **frontend:** show unknown archive days as a dash in About ([3f6b4d1](https://github.com/xebjhm/SakaDesk/commit/3f6b4d10ef3f6789f8ba2c3c94758d5128e8b8c3))
* **frontend:** square Atmosphere orbs and fade them in About ([102c67d](https://github.com/xebjhm/SakaDesk/commit/102c67d89d98f0a982f2c9491a663c0d5b844ad2))
* **layout:** ring the selected group logo; label the rails ([bf57fc2](https://github.com/xebjhm/SakaDesk/commit/bf57fc2fd007ca8566019bd342ccf19cf48cb125))
* **letters:** consistent arrow order and a roomier narrow layout ([f8d8198](https://github.com/xebjhm/SakaDesk/commit/f8d819814116a914a804eb400ccceb659a212a62))
* **letters:** keep viewer tools and reset it on room change ([9afc1eb](https://github.com/xebjhm/SakaDesk/commit/9afc1eb2734b4fcff4858900ed7e6eeb814104bb))
* **log:** accept the font breadcrumbs ([cb4b533](https://github.com/xebjhm/SakaDesk/commit/cb4b53352f1dba53cd930866d9392e529879aae1))
* **login:** show the Yodel geo warning in the login's group ([1824cdc](https://github.com/xebjhm/SakaDesk/commit/1824cdc270f3d8269e8cdacaece1ed76a145fae4))
* **log:** log sidebar and read-state skips once, not per tick ([8e4d8a5](https://github.com/xebjhm/SakaDesk/commit/8e4d8a54e863a7b7079fe1c8c8dd01f533614cd9))
* **log:** treat a font fallback as a warning ([afac2ed](https://github.com/xebjhm/SakaDesk/commit/afac2ed231e84c2c6d4caec973e787afa673a738))
* **media:** accurate buffering state and logged audio failures ([0e54be7](https://github.com/xebjhm/SakaDesk/commit/0e54be7200eb92a7835e44a2b65ea96e3edd6788))
* **media:** exact fit zoom, unclipped scrollbars and reliable durations ([0a7d13b](https://github.com/xebjhm/SakaDesk/commit/0a7d13bdb3680eddcb245dbe7f0fa32fcc69881b))
* **media:** harden avatar resizing against races and huge sources ([d22e937](https://github.com/xebjhm/SakaDesk/commit/d22e937989b17e107063ee273d98adc7886d4d7a))
* **media:** honour If-Range and guard the proactor patch ([c8292be](https://github.com/xebjhm/SakaDesk/commit/c8292bec30b22edfc9297dd92b5f9b1d0a0a640f))
* **media:** inset scrollbar bottom only and tighten tests ([4a63c9d](https://github.com/xebjhm/SakaDesk/commit/4a63c9d94b702ca5f9705ac8afd41bf1d379a3bd))
* **media:** keep gallery tabs out of the scrolling area ([04fc7bb](https://github.com/xebjhm/SakaDesk/commit/04fc7bbb5ae7e108b7fdf35a2c4103e46f1b8617))
* **media:** keep viewer keys and player shortcuts out of menus ([e8a6ba2](https://github.com/xebjhm/SakaDesk/commit/e8a6ba27cfbb8f5f68495d6ddbda1f99b657b9a8))
* **media:** left is older and right is newer in every viewer ([4034e51](https://github.com/xebjhm/SakaDesk/commit/4034e51fc81542481a22b7af128fbc689773bd8c))
* **media:** let video and voice own the viewer up/down keys ([6921c7e](https://github.com/xebjhm/SakaDesk/commit/6921c7e0271c28cdbc9ff27d4ae1873ee58c40ea))
* **media:** release players and show buffering and errors ([d1a7cb8](https://github.com/xebjhm/SakaDesk/commit/d1a7cb8fd45fdc2add3c87834395ce3124a3b8f4))
* **media:** request avatar sizes matched to the screen ([12b3144](https://github.com/xebjhm/SakaDesk/commit/12b31442f3ca54a40e4e391f4e20941aa7ff5f1a))
* **media:** serve video in bounded ranges so playback never jams ([2bfe89d](https://github.com/xebjhm/SakaDesk/commit/2bfe89d9c6ebfb91a29a418571a1d28d9c005855))
* **members:** keep the floating last-sync pill ([98c65a6](https://github.com/xebjhm/SakaDesk/commit/98c65a6e94bf43cf576f764f30c3aa40d57ab8b9))
* **members:** keep the selection ring sharp and unfiltered ([4540675](https://github.com/xebjhm/SakaDesk/commit/45406758e74333ba187220a65f0e64c2a321579b))
* **messages:** drop the milestone card when the room changes ([9b371d9](https://github.com/xebjhm/SakaDesk/commit/9b371d93f14a86e68f2754470bab7cb38d21b04c))
* **messages:** show at most one milestone card per open ([418e5c1](https://github.com/xebjhm/SakaDesk/commit/418e5c18117f0905b2f3298d26f991987664d6e8))
* **nickname:** replace %%% in Windows toasts and Favorites ([ecefa4c](https://github.com/xebjhm/SakaDesk/commit/ecefa4cd9bea631eff3897300f807fb6445447a1))
* **notify:** queue concurrent toasts instead of dropping them ([3417bb0](https://github.com/xebjhm/SakaDesk/commit/3417bb0397c6c2122c8c520f18fa289ed12ff604))
* **notify:** refuse open-login when the dialog cannot show ([f6ad887](https://github.com/xebjhm/SakaDesk/commit/f6ad887542e1fde163cd4e8f048a948a91119b33))
* **read-state:** keep a loaded cache when a refresh fails ([f66d926](https://github.com/xebjhm/SakaDesk/commit/f66d9260c2fe729080e0c94d73fd4999847b60cf))
* **read-state:** keep retrying the conversation cache load ([3d229ba](https://github.com/xebjhm/SakaDesk/commit/3d229baacff6c069aabcf13000eaaac8a2450cc6))
* **read-state:** merge recovered rows into the open chat ([02559c6](https://github.com/xebjhm/SakaDesk/commit/02559c6693d4a6ba63a6d8b6d95dd39872582d12))
* **read-state:** never overwrite read progress after a failed load ([d393fc0](https://github.com/xebjhm/SakaDesk/commit/d393fc09a779789080b47f3385763dbe59456058))
* **read-state:** save progress read while the cache was down ([fb8808e](https://github.com/xebjhm/SakaDesk/commit/fb8808e2b32d00050190a8168006e842cd899193))
* renew sessions silently, recover read state, clean call popup ([fc5c0c5](https://github.com/xebjhm/SakaDesk/commit/fc5c0c5adb6882d3fc129180631bebbdfd2629c0))
* **search:** log status, member and load-more outcomes; IME-safe keys ([04a398e](https://github.com/xebjhm/SakaDesk/commit/04a398ec29cc7e182fd7c3e9a68b586c9edc91d2))
* **search:** translate the member count in the filter list ([48c4c14](https://github.com/xebjhm/SakaDesk/commit/48c4c14b1397b38553ad87597e0e4d0a8a1c1c77))
* **server:** back off accept re-arms after a reset streak ([ac34344](https://github.com/xebjhm/SakaDesk/commit/ac343444fe6dcb904330a4df6a7fdef32309bc91))
* **server:** keep accepting after a browser resets a new connection ([bd67e24](https://github.com/xebjhm/SakaDesk/commit/bd67e24a6494985145fddb292b04fcdc6bfeb7aa))
* **server:** outlast browser idle sockets to stop lost poll requests ([5e66a81](https://github.com/xebjhm/SakaDesk/commit/5e66a810329a1c96c98d92be386e0fa58060c7f8))
* **server:** re-arm accept after a synchronous connection reset ([9810701](https://github.com/xebjhm/SakaDesk/commit/9810701bf06e050312ef6f41eeda49c29097ff37))
* **server:** stop long-session media and poll stalls ([3f3d940](https://github.com/xebjhm/SakaDesk/commit/3f3d94070a3806f7210414e8239fe41bea5efcda))
* **session:** gap strikes and clear marks only on real refresh ([14fd501](https://github.com/xebjhm/SakaDesk/commit/14fd501eb79144157df753c008d106d8c4927de7))
* **session:** retry refresh_failed marks on a slow cadence ([f050cf2](https://github.com/xebjhm/SakaDesk/commit/f050cf233cfc0aecbbf8169925e1f41a12d22ba2))
* **settings:** let the save error toast close and follow the language ([94aaf21](https://github.com/xebjhm/SakaDesk/commit/94aaf21adecb6f4995c9138b16b834f1871521f6))
* **settings:** log every load and save failure and show it inline ([ffa2400](https://github.com/xebjhm/SakaDesk/commit/ffa24009041fb774bc9bf044c648b88812c978d9))
* **settings:** never overlap blog stats reads during a backup ([65a2276](https://github.com/xebjhm/SakaDesk/commit/65a227638a7c0feb56d7ba5a5cc1b251a4873766))
* **settings:** never overwrite an unreadable settings.json ([6205e53](https://github.com/xebjhm/SakaDesk/commit/6205e53d4eebfcb25ef4e64510de93359fc502d5))
* **settings:** report cache clear and connection test outcomes ([ee4694c](https://github.com/xebjhm/SakaDesk/commit/ee4694c5e001e311e22835d2d810c1f5eb5dcfa3))
* **settings:** show save failures on the row and above the dialog ([d2fe82c](https://github.com/xebjhm/SakaDesk/commit/d2fe82c80af735d8f887c98183b6a9dbc4e705d5))
* **settings:** skip the render when a save does not change a row ([3fa40d6](https://github.com/xebjhm/SakaDesk/commit/3fa40d683890586d5b140e0ae4cb4c787741741c))
* **settings:** stop the backup status poll when the dialog closes ([e409e80](https://github.com/xebjhm/SakaDesk/commit/e409e806955c245ae188d10612f22257e4415299))
* **shell:** log a failed main-window route load ([e83913c](https://github.com/xebjhm/SakaDesk/commit/e83913c2db438b8656129737a52541aeb263200e))
* **sidebar:** announce each member's name once ([4eb11ab](https://github.com/xebjhm/SakaDesk/commit/4eb11ab2e3a104bd41c173ad97f2519cec421b0f))
* **sidebar:** clear the previous group's list on a group switch ([613b3cc](https://github.com/xebjhm/SakaDesk/commit/613b3cc627c2082bf68a2677b315f943d9c58fe9))
* **sidebar:** keep the spinner while a slow first load finishes ([d8be4d4](https://github.com/xebjhm/SakaDesk/commit/d8be4d47652fd60f6e41b09747cc07f6ca4cb0fb))
* **sync:** add non-colour step cues and stack stat units ([34d87bd](https://github.com/xebjhm/SakaDesk/commit/34d87bd0c51d03f1575069c55bc8daa1433188d7))
* **sync:** close coordinator cancel and failure gaps ([53078d8](https://github.com/xebjhm/SakaDesk/commit/53078d88393f67fdd4f4c682cd75c696d4444aa0))
* **sync:** close the start guard's gaps on a refused start ([80f75b4](https://github.com/xebjhm/SakaDesk/commit/80f75b4db979918a66b4269db864216e4a7cc0e8))
* **sync:** keep retrying progress reads while a sync is running ([0b499f6](https://github.com/xebjhm/SakaDesk/commit/0b499f6b95ce11936be5dd8735722ebfab63adc7))
* **sync:** keep the dialog honest on queued, lost and cancelled runs ([1a0a1cd](https://github.com/xebjhm/SakaDesk/commit/1a0a1cd376e4ed449157872d3052c9c7c1730a83))
* **sync:** keep the synced group's colours on Complete ([a1ee3ce](https://github.com/xebjhm/SakaDesk/commit/a1ee3cee6ec0a0c72a1e10ae0842bf274af4964d))
* **sync:** latest-wins polls, bounded progress retries ([8257d53](https://github.com/xebjhm/SakaDesk/commit/8257d5328bf718b4794c32d7ab3ff9b6d232537c))
* **sync:** let cancel end the first-launch sync ([c4ad2ae](https://github.com/xebjhm/SakaDesk/commit/c4ad2ae48315adf8b6ad2a56392211f8f2f8e9d5))
* **sync:** log stale-service drops, tidy polling docs and constants ([22ed79e](https://github.com/xebjhm/SakaDesk/commit/22ed79e76f595d409644b173fc2efa8c11a1a082))
* **sync:** report real counts when a sequence is cancelled ([f744177](https://github.com/xebjhm/SakaDesk/commit/f74417740d86dc425c91f003ddf1cb354303b116))
* **sync:** report real counts when a sequence is cancelled ([0ac53d6](https://github.com/xebjhm/SakaDesk/commit/0ac53d62384af19399f986249e0cf3ef4168bc0f))
* **sync:** report session success only for a completed sync ([ae2cbb8](https://github.com/xebjhm/SakaDesk/commit/ae2cbb8795a761a87e46c9240891a88d578b9afb))
* **sync:** skip a second start while the first start is in flight ([b27224e](https://github.com/xebjhm/SakaDesk/commit/b27224e2139a0e901e5469e8ae29743af38b3e97))
* **sync:** uncached, non-overlapping polls with timeouts ([6cc0988](https://github.com/xebjhm/SakaDesk/commit/6cc09880646143a0789dce988e6c4a03712983ff))
* **tray:** keep the tooltip when the unread count fails ([03625fd](https://github.com/xebjhm/SakaDesk/commit/03625fd27d973636967634777c626d6735a5ddcb))
* **tray:** put the login line first and name the icon failure ([4170b15](https://github.com/xebjhm/SakaDesk/commit/4170b159c764f77c7deb09b0f2da8ff5d18914ab))
* **tray:** shrink the login warning dot to a third of the icon ([ba3749d](https://github.com/xebjhm/SakaDesk/commit/ba3749dd8a18f39e64b2bed7dee2a32c3638accf))
* **ui:** close real-data re-QA residuals ([0b2aa67](https://github.com/xebjhm/SakaDesk/commit/0b2aa67ea3986e6d979b925fadc30dea3d29e0ce))
* **ui:** darker muted text, official Hina covers, neutral translate ([47c24d6](https://github.com/xebjhm/SakaDesk/commit/47c24d6de014b2fa59073fb2f28c0b50243dcd1c))
* **ui:** keep counts and the menu star out of group colour ([167e084](https://github.com/xebjhm/SakaDesk/commit/167e0849163981a5fd6d46f2d8e73d606ccce693))
* **ui:** keep dialog close buttons rounded ([660f6b0](https://github.com/xebjhm/SakaDesk/commit/660f6b0520941b74a50df2bb31015f8b8770445a))
* **ui:** keep landing feature chips visible on a hovered card ([5634af5](https://github.com/xebjhm/SakaDesk/commit/5634af5d2185150de511449578126afefe87cf8b))
* **ui:** keep lazy placeholders loading and log thumb fallback ([aeef828](https://github.com/xebjhm/SakaDesk/commit/aeef828ce5f45aa8ec4a90d04c6bfa97509d4425))
* **ui:** keep login locked while in flight across services ([6da391d](https://github.com/xebjhm/SakaDesk/commit/6da391d551f07422ab5c03be7f4cf1bfce7d8648))
* **ui:** lock login across the Yodel geo check and onSuccess ([a65ba81](https://github.com/xebjhm/SakaDesk/commit/a65ba81d1570aa92cea9642245efbca22491fc35))
* **ui:** log profile image and background upload outcomes ([f8f0b5e](https://github.com/xebjhm/SakaDesk/commit/f8f0b5e4b62bc827d8ba71998d7e011465cd4063))
* **ui:** log video thumb errors and use a modal body ref ([8be5664](https://github.com/xebjhm/SakaDesk/commit/8be5664519256eb26c24a401b49de1e3f4087cc3))
* **ui:** make the login lock app-wide and survive unmounts ([36d5d69](https://github.com/xebjhm/SakaDesk/commit/36d5d69b6bc9a87adf28c98e81eb83f1f866f216))
* **ui:** name the skeleton colour and correct scrollbar docs ([ab70755](https://github.com/xebjhm/SakaDesk/commit/ab70755f481f9b0c0ea60556a8ad508ed57c93ab))
* **ui:** readable grey text on grey surfaces ([b1ea0a1](https://github.com/xebjhm/SakaDesk/commit/b1ea0a1239c36ff695856fcf096e7e0ce6c7d5ea))
* **ui:** real-data QA fixes and a sent-letter viewer ([fa99413](https://github.com/xebjhm/SakaDesk/commit/fa99413ac494569495703be769c84b3897ceb571))
* **ui:** show placeholders while favourites and members load ([74a3ff9](https://github.com/xebjhm/SakaDesk/commit/74a3ff976deb796a2de0819937d39bee8ec371b3))
* **ui:** start at the top after switching tabs or filters ([c959bc9](https://github.com/xebjhm/SakaDesk/commit/c959bc9e0ea96f4cd6f04e65829f4cdc1ae207d9))
* **ui:** steady scrollbars and log lazy video fallback ([dc5e399](https://github.com/xebjhm/SakaDesk/commit/dc5e39961c02218df3a084d4504a7a0b4a2747cf))
* **ui:** tidy R-a docs, tests and the update dismiss hover ([a1e12ca](https://github.com/xebjhm/SakaDesk/commit/a1e12ca25981bf60df8298d82d6b2586496583ae))
* **ui:** use secondary text for the light login banner's service line ([e124287](https://github.com/xebjhm/SakaDesk/commit/e1242870022c8b438ba6be61b5b126cd818f62a4))
* upgrade cancel race, nickname in toasts, letters count ([665b65c](https://github.com/xebjhm/SakaDesk/commit/665b65c948ec9971669e9a522779336805c63f6a))
* **upgrade:** close the cancel-during-start and double-install gaps ([d599151](https://github.com/xebjhm/SakaDesk/commit/d599151b6c7b6d174c0943a6c4ca6043d8fdcaac))
* **upgrade:** harden error paths found in the release review ([7946090](https://github.com/xebjhm/SakaDesk/commit/7946090a095d9ac95d8a366d9d1c1b6df6acc925))
* **upgrade:** keep user paths out of upgrade logs ([2e29663](https://github.com/xebjhm/SakaDesk/commit/2e29663215ceac0e8305bd8b5c4d768e8f5017bf))
* **upgrade:** stop the download on cancel so retries never share a file ([b5b0bd3](https://github.com/xebjhm/SakaDesk/commit/b5b0bd33d2bc4fe3dab189852886146a0f60705f))


### Changed

* **about:** move archive stats out of About ([ae89d88](https://github.com/xebjhm/SakaDesk/commit/ae89d8849a00f182b4d96a36de6f2bfb8c640bab))
* **app:** batch translation lookups and lazy-load favourite voices ([7577a3c](https://github.com/xebjhm/SakaDesk/commit/7577a3c78f851bd67b93b1408b3ceea69f749793))
* **auth:** use asyncio.timeout in the refresh gate ([7536e2f](https://github.com/xebjhm/SakaDesk/commit/7536e2fb2581036a277b30e9f22944b2848d7158))
* **blogs:** fast, non-overlapping blog cache stats in Settings ([ff275db](https://github.com/xebjhm/SakaDesk/commit/ff275dbb055a86394eb5952cae2b9031d61c4542))
* **blogs:** resolve the blogs folder once per loop, off the event loop ([8c67cc5](https://github.com/xebjhm/SakaDesk/commit/8c67cc5218ac18d208eb6461369e0297c05a488e))
* **blogs:** resolve the blogs folder once per loop, off the event loop ([71c44d2](https://github.com/xebjhm/SakaDesk/commit/71c44d2618b1362acdc09e44d91bb24cb7ab43e4))
* **blogs:** scan blog cache size with scandir, once per request ([23319e5](https://github.com/xebjhm/SakaDesk/commit/23319e53e1dae5665c1817ed59e5f25a4a47c4f6))
* **chat:** drive the list, restore and unread nav by the timeline ([3069ac6](https://github.com/xebjhm/SakaDesk/commit/3069ac6190c13f9aaac8ff777c459d90e1630fee))
* **chat:** extract landing highlight into useLandingHighlight ([aae7b3e](https://github.com/xebjhm/SakaDesk/commit/aae7b3e370bd27014f570c9e1d37c9ffb70738fe))
* **chat:** resolve jumps on the timeline model by row key ([c31a190](https://github.com/xebjhm/SakaDesk/commit/c31a19019afacae11f4ff6113425f5104018f7e9))
* **design:** keep glow geometry and canvas value in tokens ([4b8b87e](https://github.com/xebjhm/SakaDesk/commit/4b8b87ee597c62f54ed759987e5075e80696cbaa))
* **design:** read legacy theme values from tokens ([8f216f1](https://github.com/xebjhm/SakaDesk/commit/8f216f17b662f232e6a0c4b6e7958aed48988120))
* **design:** use the token fallback for media accent colours ([0c45abc](https://github.com/xebjhm/SakaDesk/commit/0c45abca079d213f7b8808093d912a6087e88781))
* **diagnostics:** compute disk usage in the background ([db46ee7](https://github.com/xebjhm/SakaDesk/commit/db46ee7b9d8072c584b04c8aaac890a2e255c021))
* **log:** share breadcrumbCode and time out client-log POSTs ([da3da7f](https://github.com/xebjhm/SakaDesk/commit/da3da7f5c56f37a69b454497bc58a08c8e3b7adc))
* **media:** move the voice player to ink neutral tokens ([c607c05](https://github.com/xebjhm/SakaDesk/commit/c607c0519092380c4733015161b36a4669fb7996))
* **server:** sample media request logs and add summaries ([5231656](https://github.com/xebjhm/SakaDesk/commit/52316563a350be6250c5c92da139c585f106191e))
* **ui:** put entry shells on Modal and drop legacy theme fields ([21eec97](https://github.com/xebjhm/SakaDesk/commit/21eec97afbe0f259c5e713f5487073edfde330fc))


### Documentation

* **about:** drop stale archive-stats changelog entry ([e42fffc](https://github.com/xebjhm/SakaDesk/commit/e42fffc189c2921077093596c16e352a81416902))
* align dev keep-alive flag and favourites voice lazy-mount ([2525fb9](https://github.com/xebjhm/SakaDesk/commit/2525fb9914b8e9979577c698f0939dc56eb2875d))
* **archive:** name the first-sync toast as the archive stats caller ([2a8e309](https://github.com/xebjhm/SakaDesk/commit/2a8e3094ceddbd86ada331e55c6d73c08308f9a7))
* **backlog:** note D2c review nits for E ([fde8579](https://github.com/xebjhm/SakaDesk/commit/fde8579802bc6b9554cdb664e8f801816e007832))
* **blog:** add the D2b blog screens design spec ([0487e95](https://github.com/xebjhm/SakaDesk/commit/0487e950cbd1b0e0e837bf6e10bd68104c45b988))
* **blog:** add the D2b blog screens implementation plan ([879a5e6](https://github.com/xebjhm/SakaDesk/commit/879a5e625a909c2afcd57e5bbf5d8157ca149d70))
* **blog:** keep D2b orbs, penlight wash and serif; fix three bugs ([5bc95bc](https://github.com/xebjhm/SakaDesk/commit/5bc95bc057beefb9258730af48be69d39ca3754e))
* **blog:** keep the D2b serif on blog titles only ([f7e5818](https://github.com/xebjhm/SakaDesk/commit/f7e58184b93c90ccb5b3dbfd4e09c40d7f9ce632))
* **blog:** record the D2b blog screens in the changelog and spec ([ab36e1d](https://github.com/xebjhm/SakaDesk/commit/ab36e1d182c4bd58e4c778a1e43754788d804d77))
* **blog:** tighten D2b wording and test the wash with a real member ([a86d19f](https://github.com/xebjhm/SakaDesk/commit/a86d19f65ae7e7547e3f0d4074aec142ee91a494))
* **call-popup:** add the changelog entry and readme notes ([e60b29a](https://github.com/xebjhm/SakaDesk/commit/e60b29ac1368e3aeeed28792817b9b405ab92050))
* **call-popup:** sync the design spec with the code ([5fd9da2](https://github.com/xebjhm/SakaDesk/commit/5fd9da23d052e629577223969af6ac9d8a3ab9f6))
* **changelog:** describe 0.4.0 as net changes since 0.3.4 ([882d0c3](https://github.com/xebjhm/SakaDesk/commit/882d0c34f79c758b4722af4db09aa2d679e8b8e8))
* **changelog:** describe the Settings blog totals fix as measured ([22637e1](https://github.com/xebjhm/SakaDesk/commit/22637e1be4b279a41affa6661bd8efc87922caf0))
* **changelog:** drop the font entry until content is marked ([44d5c8b](https://github.com/xebjhm/SakaDesk/commit/44d5c8be10a3cb4889868373b061bc816a852d5a))
* **changelog:** note acceptance round 3 changes ([7765524](https://github.com/xebjhm/SakaDesk/commit/77655244b14033f0f7a51af6a52564b5f185c2ee))
* **changelog:** note calmer group colour usage ([d93c604](https://github.com/xebjhm/SakaDesk/commit/d93c6045f5b5da16db012bf48b3553aedc543e30))
* **changelog:** note media reliability fixes ([adaff42](https://github.com/xebjhm/SakaDesk/commit/adaff42de59aa2360aa24257e33b0de56ff27d85))
* **changelog:** note one-at-a-time sync and honest progress ([816cb39](https://github.com/xebjhm/SakaDesk/commit/816cb39608b4b4ceb10f04f32ce0e2e49e81c164))
* **changelog:** note QA fixes and the letter viewer ([6741cdf](https://github.com/xebjhm/SakaDesk/commit/6741cdfda00fbb3116bfaef2debf51627eb4cfd0))
* **changelog:** note re-QA fixes ([e99ba81](https://github.com/xebjhm/SakaDesk/commit/e99ba8152ec79a62b449fdaa7718521c7faae550))
* **changelog:** note the 0.4.1 fixes under Unreleased ([decb030](https://github.com/xebjhm/SakaDesk/commit/decb0308e738a5e1489e53a7d73603000d0d3a5c))
* **changelog:** note the unified group colours ([f8ebfc4](https://github.com/xebjhm/SakaDesk/commit/f8ebfc43829f815d7b25a44019a512b70a6a145d))
* **changelog:** note update actions in Settings ([5914330](https://github.com/xebjhm/SakaDesk/commit/5914330624ae3a6342ec4857d4071c201231e35e))
* **changelog:** wrap the 0.4.2 offline sentence ([1095bb5](https://github.com/xebjhm/SakaDesk/commit/1095bb5301ba2ec15c1821c293fb257704aff095))
* **chat:** align D2a-0 spec and changelog with final jump behaviour ([2b4eb18](https://github.com/xebjhm/SakaDesk/commit/2b4eb18262a5c431491057d0c61d59fb73a68df1))
* **chat:** explain far_snap as a stale lead-in distance ([d1e15bb](https://github.com/xebjhm/SakaDesk/commit/d1e15bb04c4b7d2e8ff95abb86bf45086eeb82f4))
* correct the first-sync cancel changelog entry ([9a3aef0](https://github.com/xebjhm/SakaDesk/commit/9a3aef0630eb3851989631b8d1a5715ed07abf2c))
* **design:** add D1 design-system foundation spec ([5839752](https://github.com/xebjhm/SakaDesk/commit/583975246ba46a2d835236c9e79725cd00b6b213))
* **design:** add D1 implementation plan and sync spec ([bd13805](https://github.com/xebjhm/SakaDesk/commit/bd138052a5d974e60c4a94367176599cd64cedba))
* **design:** add D1.5 colour system implementation plan ([eda07a4](https://github.com/xebjhm/SakaDesk/commit/eda07a422095511798921234ab3444f5ff1ec4c4))
* **design:** add D1.5 unified colour system spec ([228efcd](https://github.com/xebjhm/SakaDesk/commit/228efcd3347fa6fc3a77c7d5d96bed17420d8ca6))
* **design:** add design language v2 spec ([02ab995](https://github.com/xebjhm/SakaDesk/commit/02ab995abe5e5f1c547dc575992c46201defe8e9))
* **design:** add v2 foundation plan ([2a91540](https://github.com/xebjhm/SakaDesk/commit/2a91540f86df96614d00d39ca87d1649ed23de07))
* **design:** add v2 re-apply plan for blogs ([23ede6b](https://github.com/xebjhm/SakaDesk/commit/23ede6bab5a00bf51c5c509ea09993c89a4c8b43))
* **design:** add v2 re-apply plan for dialogs ([67f9304](https://github.com/xebjhm/SakaDesk/commit/67f9304df473285049b403f8c7b5f6e04e9d75e9))
* **design:** add v2 re-apply plan for frame and chat ([fa641d8](https://github.com/xebjhm/SakaDesk/commit/fa641d822845b1524a91bc17544f3672a7a3b08a))
* **design:** align group-colour rules with the colour roles ([8a735be](https://github.com/xebjhm/SakaDesk/commit/8a735be30c46fde5c77f6b26fd52d8328b8a7ab0))
* **design:** bring back the yellow favourite star in R-b ([876e2fa](https://github.com/xebjhm/SakaDesk/commit/876e2fadf512413c57deb712b39991fa057606c1))
* **design:** document the design system and agent rule ([e3ec416](https://github.com/xebjhm/SakaDesk/commit/e3ec416d3df84700c15e39b1398db4516f07f346))
* **design:** document the unified colour system ([9b1a5f1](https://github.com/xebjhm/SakaDesk/commit/9b1a5f18c6aa5798d54fe398b113d4ed9a84144c))
* **design:** document warning button, icon sizes, contrast figure and ja marking scope ([a373ace](https://github.com/xebjhm/SakaDesk/commit/a373acea23fc491da21597060802e43cdfae90bd))
* **design:** drop the D5 deviation, document wash and frost ([b63a6e6](https://github.com/xebjhm/SakaDesk/commit/b63a6e6a2e28b661bc23b084e70dbb5bdf10a424))
* **design:** fix drift in design-system docs and comments ([0ffbfb2](https://github.com/xebjhm/SakaDesk/commit/0ffbfb262e4c42a1d18cd7b67c1b30c736e4601f))
* **design:** note the Windows title bar colours ([2c717d7](https://github.com/xebjhm/SakaDesk/commit/2c717d7da7a4b8a797f79ff5c2caa96105ef18b1))
* **design:** record R-a decisions as accepted ([de0b44b](https://github.com/xebjhm/SakaDesk/commit/de0b44badd67a09376e7730fd33d783e0afb85e3))
* **design:** record R-b decisions and the oshi colour ([3ffb08c](https://github.com/xebjhm/SakaDesk/commit/3ffb08c73bb240c1159ff8f441c67d3a02ca6ac3))
* **design:** record R-c dialog decisions ([29e7034](https://github.com/xebjhm/SakaDesk/commit/29e7034038f47bd69d586ad367fb5be0e27e455f))
* **design:** record R-d decisions ([b478830](https://github.com/xebjhm/SakaDesk/commit/b47883081230472cbb18d502355603bd7d058ea8))
* **design:** record the blogs re-apply and the oshi rule ([95c38b5](https://github.com/xebjhm/SakaDesk/commit/95c38b59bfef763a2504525d84990141af0c1e91))
* **design:** record the dialogs re-apply ([dcb5ee7](https://github.com/xebjhm/SakaDesk/commit/dcb5ee7353a36a2f70af23f0868272302fb77fc0))
* **design:** record the entry and brand-moment re-apply ([5aa1ecc](https://github.com/xebjhm/SakaDesk/commit/5aa1eccd1c0d393e8bc5974b69f663d4303784dc))
* **design:** record the frame and chat re-apply ([fa29229](https://github.com/xebjhm/SakaDesk/commit/fa292294e0b614cdae1ef42d5eff205b049e912e))
* **design:** rewrite the design system for language v2 ([7c81ad7](https://github.com/xebjhm/SakaDesk/commit/7c81ad7b052423de5626c24e21b72206d2f205e8))
* **frontend:** fix scope, voice card and ToS comments ([c734ff5](https://github.com/xebjhm/SakaDesk/commit/c734ff5bc0722e810cac7d6847ffb6a66fe93c54))
* note instant timeline jumps ([fdd943a](https://github.com/xebjhm/SakaDesk/commit/fdd943a586a8445b0ac9ee145dc0a7d5abb996df))
* **plan:** 0.4.2 reliability implementation plan ([f35429d](https://github.com/xebjhm/SakaDesk/commit/f35429d55dddd42df47f52b04ffd648048849d62))
* **plan:** add acceptance round 3 plan (R-h) ([a47f009](https://github.com/xebjhm/SakaDesk/commit/a47f0092f5a2bb5d3e0dc1ab2eb241218b40016e))
* **plan:** add D2a-0 timeline jump plan ([046a128](https://github.com/xebjhm/SakaDesk/commit/046a128cf95b2cd1cec4d72a050ec83f3d13beba))
* **plan:** add jump motion follow-up tasks ([29faaf7](https://github.com/xebjhm/SakaDesk/commit/29faaf7695e82c8d39e4e639db5c941f10cd7890))
* **plan:** add media and polling reliability plan (R-i) ([87a739a](https://github.com/xebjhm/SakaDesk/commit/87a739a85fc484529c50ef21920c68660ac8fb33))
* **plan:** add media streaming fixes to R-h ([71a6c0f](https://github.com/xebjhm/SakaDesk/commit/71a6c0f5b4e244c46e4dbcd64fdd112563bbb124))
* **plan:** add re-QA residuals plan (R-g) ([5b2670d](https://github.com/xebjhm/SakaDesk/commit/5b2670d2638dbda9f468517043979462b53ca999))
* **plan:** add real-data QA fixes and letter viewer plan (R-f) ([1ef2341](https://github.com/xebjhm/SakaDesk/commit/1ef2341578b80ee5f2ef02a53f6395be208ebe32))
* **plan:** add the D2a chat frame implementation plan ([f1e2847](https://github.com/xebjhm/SakaDesk/commit/f1e28476738952aa0a3eeaa365530fa25de71486))
* **plan:** add the v2 re-apply R-d entry and brand plan ([d6e313d](https://github.com/xebjhm/SakaDesk/commit/d6e313df2f080df6e381af73f465ebdcd8bc222c))
* **plan:** add v2 accent restraint plan (R-e) ([f20799b](https://github.com/xebjhm/SakaDesk/commit/f20799b0e626701d3e021297cc6bc0dcac21a0c4))
* **plan:** add Yodel official shelter restore to R-e ([2100812](https://github.com/xebjhm/SakaDesk/commit/21008121bb4e4c43461d1832e742ab66d1c3e48e))
* **plan:** cache the member streak per room per local day ([d24903d](https://github.com/xebjhm/SakaDesk/commit/d24903d162b08b17f4df1ed87a6e6bbc3ea679d6))
* **plan:** note unverified Nogizaka and Yodel shelter colours ([9257bf0](https://github.com/xebjhm/SakaDesk/commit/9257bf0b74297896d071b233613016d216ae78b8))
* **plan:** plan D2c dialogs, viewers and menus in 14 tasks ([4c98209](https://github.com/xebjhm/SakaDesk/commit/4c98209234547ef572339a4e54cd948a1b5136c7))
* **plan:** revert Yodel covers to the logo palette (R-g) ([15e81b8](https://github.com/xebjhm/SakaDesk/commit/15e81b865a23a73664b7439fd6c807b237b99f82))
* record 0.4.2 renewal refinements and changelog ([4c5d163](https://github.com/xebjhm/SakaDesk/commit/4c5d163e3bd99d853e9a5861f3d7d1a680fd4317))
* record strike gap and clearing rules; mark plan historical ([10ff7ca](https://github.com/xebjhm/SakaDesk/commit/10ff7cae5c1935f87dda75e28b55948c7e7669b0))
* record the D2a chat frame in the spec and changelog ([6047b80](https://github.com/xebjhm/SakaDesk/commit/6047b80195d9a13ed1ae5695cddcc47109c09f12))
* **spec:** 0.4.2 reliability design (renewal, read state, popup frame) ([d5d9723](https://github.com/xebjhm/SakaDesk/commit/d5d9723af4ad3f63824cd44fdf64eafd54057b36))
* **spec:** add D2a chat frame and timeline jump design ([7f50e89](https://github.com/xebjhm/SakaDesk/commit/7f50e89b29c19a6114c8f2b8445016dfa1f72eca))
* **spec:** add sync coordinator and honest progress design ([591a3f3](https://github.com/xebjhm/SakaDesk/commit/591a3f3e06e55b0756f7fd31943fbfe26e65780d))
* **spec:** align 0.4.2 reliability spec with the code ([fa3615b](https://github.com/xebjhm/SakaDesk/commit/fa3615b411e4b804e2af24314b9d6f448d6e443b))
* **spec:** align D2c spec with its implementation plan ([478a71a](https://github.com/xebjhm/SakaDesk/commit/478a71acb98e544b78c86d9b8b16218d6cf7225d))
* **spec:** B4 is confirmed on the released build ([af02897](https://github.com/xebjhm/SakaDesk/commit/af02897166e819be50198f920634e0d77ff1cd6f))
* **spec:** design D2c dialogs, viewers and menus ([0e968af](https://github.com/xebjhm/SakaDesk/commit/0e968af8ff8c193201cbf282c39aaa65b365b051))
* **spec:** fold D2a-0 review constraints into the D2a timeline ([a2998cc](https://github.com/xebjhm/SakaDesk/commit/a2998cc1b9c1937a995078834d349ff6d9723b9a))
* **spec:** record sync order and pysaka deferral details ([bd8b9bd](https://github.com/xebjhm/SakaDesk/commit/bd8b9bdbceb0fbc85f8c207a7a4caac782e52049))
* **sync:** align docstrings, spec and changelog with the code ([d43ac79](https://github.com/xebjhm/SakaDesk/commit/d43ac790f43e8366f83121b9bf5cf14e215ebb4a))
* **ui:** add the D2d entry screens design spec ([5292e47](https://github.com/xebjhm/SakaDesk/commit/5292e47bd84345e28950263beefb1fa1ec68e2b5))
* **ui:** add the D2d entry screens implementation plan ([953c193](https://github.com/xebjhm/SakaDesk/commit/953c1933ab7124a4d754fab24f0020e3437ef178))
* **ui:** note the login dialog close and verify flag in the E list ([7012a59](https://github.com/xebjhm/SakaDesk/commit/7012a59090b1cdc23437a38dbfa391bffe69312e))
* **ui:** record D2d in the changelog, E list and spec ([1a4227b](https://github.com/xebjhm/SakaDesk/commit/1a4227b4c569fa2c0f279eb6c405c7b223112106))
* **ui:** record the app-wide login lock and start guard in the spec ([5373f0c](https://github.com/xebjhm/SakaDesk/commit/5373f0cc29e651c13df3f0b4cf4605436d48803d))
* **ui:** record the D2c dialogs in the design system and changelog ([c0f91a2](https://github.com/xebjhm/SakaDesk/commit/c0f91a216dd829c0337824d18a1a3d86a2e4d964))

## [Unreleased]

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
