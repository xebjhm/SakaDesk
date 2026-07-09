# KB Chatbot UX Overhaul — Structural Plan

> Produced 2026-07-10 from a three-lens expert design review (first-run flow,
> settings information architecture, chat surface) + synthesis, triggered by
> the owner's battle-field verdict: "looks like a mess — no order, scattering,
> duplicating." The QUICK WINS from that review shipped in the same-day wave
> (scroll hijack, enable-toggle row, always-visible API key, openSettings
> action, runtime_missing mapping, live index progress, saveConfig dirty-set,
> settings de-dup/reorder, citation dedupe, quota de-dup, clear-confirm,
> polish batch). This document is the remaining STRUCTURAL work.

## Design stance

The mess has one root cause: **setup, status, and configuration were each
implemented three times and mounted in whatever surface was handy.** The fix
is a strict ownership rule:

- **Setup lives in chat** (as a wizard, the only place setup happens).
- **Configuration lives in Settings** (four titled sections).
- **Each fact is displayed by exactly one component.**
- **Readiness/config/usage/consent state lives in one store slice with one
  poller per fact.**

## Target design (one paragraph per surface)

**Chat empty state = the Setup Wizard.** Five dependency-ordered steps, every
action inline: (1) enable toggle; (2) Cloud/Local choice as two cards with the
hardware recommendation inline — choosing Cloud reveals the shared API-key
field (keyring status + "shared with translation" note) and folds the privacy
consent into the choice (killing the first-send ambush); choosing Local shows
Ollama reachability + pull helper; (3) one merged download row covering the
embedding model AND the ONNX/GPU runtime; (4) indexing with live doc-count
progress, auto-started on step-3 completion; (5) done → welcome + suggested
chips. Composer gates on all five; while blocking, the heading is "Set up the
AI Assistant — 2 of 5 done", never "Ask me anything". Mounted only in chat.

**Settings → AI tab = configuration only.** Four headed sections in dependency
order: (1) AI provider & API key (unconditional, shared-key caption);
(2) Transcription (toggle + dependency status line); (3) Translation (toggle,
target language, cache; model under a collapsed Advanced row); (4) AI
Assistant — Enable first (rest dims when off), engine choice renamed "Where
the assistant runs: Cloud / On this PC", model picker as a proper form with
dirty-state + unsaved-changes guard, ONE merged IndexStatus component, consent
status line with Revoke, usage meter with a persistent label.

**Chat thread.** Stick-to-bottom scrolling (shipped). In-flight bubble becomes
a progress surface: elapsed timer ("Thinking… 14s"), indexing context when
relevant. Citations: numbered superscript markers + one "Sources (N)" footer
per answer with deep-links. Error turns carry Retry (re-send from turn data)
with a live countdown. Quota exhaustion renders once. Header badge slim.

**Shared state.** One `aiStatus` zustand slice: readiness, backend config,
usage, consent — single pollers; wizard, Settings section 4, header badge,
meter, and the composer gate all subscribe. The composer gate becomes live
(reacts to mid-session disable) instead of a one-way per-mount latch.

**Naming.** One name — **"AI Assistant"** — across nav tab, chat header,
settings section, and every kb*/knowledge-chatbot string, all 5 locales.

## Work items (ordered by user-visible value)

- **S1. Chat Setup Wizard** — new `features/ai/components/SetupWizard.tsx`
  replacing SetupChecklist in chat: five steps as above; absorb the key field
  + keyring status; absorb the Ollama probe/pull helper from
  `KbBackendSelector.tsx:374-445`; fold consent into Cloud selection so
  `CloudConsentModal` leaves the send path (`AiFeature.tsx:298-301`); merged
  model+runtime download row; auto-index step with live progress.
  Depends on: shipped quick wins. Touch: SetupWizard.tsx (new),
  ChatWindow.tsx, AiFeature.tsx, CloudConsentModal.tsx, backend consent
  endpoint timing, locales.
- **S2. Settings AI-tab re-IA** — the four headed sections; merge the
  checklist index row + KnowledgeBaseStatus into one `IndexStatus.tsx`;
  delete twin i18n key families; KB section becomes a dirty-tracked form;
  hardware helper moves inline to the engine choice; delete
  KnowledgeBaseStatus.tsx + the Settings SetupChecklist usage (done) after S1
  removes the chat dependency. Depends on S1.
- **S3. Shared `aiStatus` store slice** — readiness/config/usage/consent,
  single pollers, live composer gate. Can run parallel to S1; land BEFORE S1
  ships to avoid triple-polling during the transition. Touch: appStore.ts,
  AiFeature.tsx, ChatWindow.tsx, SetupWizard.tsx, UsageMeter.tsx,
  SettingsModal.tsx.
- **S4. Consent management in Settings** — status line + Revoke; new
  `DELETE /api/ai/consent`. Touch: backend/api/ai.py, SettingsModal/
  KbBackendSelector, locales.
- **S5. Sources footer + numbered citations** — superscript markers,
  per-answer "Sources (N)" footer with type icon/member/timestamp/snippet/
  deep-link. Touch: ChatWindow.tsx, CitationChip.tsx, locales.
- **S6. Live progress bubble** — elapsed timer; plumb `{stage, done, total}`
  through `api.ts` (backend already emits them on the SSE heartbeat);
  indexing context line. Touch: api.ts, AiFeature.tsx, ChatWindow.tsx,
  locales.
- **S7. Retry on error turns** — Retry for transient codes re-sending from
  turn data; live `retryAfter` countdown enabling Retry at zero. Touch:
  ChatWindow.tsx, AiFeature.tsx, locales.
- **S8. Naming + idiom sweep** — "AI Assistant" everywhere; one shared Toggle
  (`role="switch"`), one Test-button pattern, one ConfirmDialog for
  destructive confirms; rename `transcriptionDevice`; translate/template the
  raw hardware reason string; include KB in Reset-to-defaults or rescope its
  copy. Touch: SettingsModal.tsx, KbBackendSelector.tsx, all locales.

## Deferred/minor debt (from the review, not scheduled)

Hardcoded "~1.1 GB" + model names in copy; per-service vs global fingerprint;
`_index_progress` history; consent revocation backend; global nav-level
indexing badge for the 60s-deferred startup catch-up build; thread
persistence across app restarts (roadmap item, distinct from this overhaul).
