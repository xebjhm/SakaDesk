# On-Demand ONNX Runtime Provisioning — Design

**Date:** 2026-07-04
**Status:** Approved (brainstorming) → pending implementation plan
**Branch:** feat/kb-integration

## Problem

The packaged Windows app bundles the CPU-only `onnxruntime` wheel, so KB embedding
always runs on CPU even on machines with a capable GPU (e.g. an RTX 3090). Bundling a
GPU runtime for *everyone* is wasteful — it's host-specific and useless to users who
can't run it. We want to ship **no onnxruntime**, and on first KB use auto-detect the
host and download the correct build, mirroring the existing embedding-model download.

Verified prerequisite (2026-07-04, RTX 3090): DirectML embeddings are numerically
identical to CPU on the granite model — cosine `1.0000000`, max abs diff `2.3e-07` —
so switching runtimes needs **no reindex** and costs **no retrieval quality**.

## Goals / Non-goals

**Goals**
- Ship the Windows installer **without** onnxruntime (base shrinks ~35 MB).
- On first KB use: auto-detect host → download `onnxruntime-directml` (NVIDIA GPU
  present) or CPU `onnxruntime` (otherwise) → verify → extract → load it.
- **Auto-detected, auto-triggered, with clear status/progress and complete logging.**
- Zero behavior change in dev / tests / non-Windows.

**Non-goals (deferred)**
- SetupChecklist / first-run UX redesign (separate future effort). This delivers
  auto-detect + auto-trigger + a status endpoint the current/future UI can surface;
  frontend wiring is minimal.
- AMD/Intel DirectML (v1 selects DirectML only for NVIDIA; others get CPU).
- CUDA / TensorRT runtimes.
- macOS/Linux packaged apps (not currently shipped; dev there uses the venv onnxruntime).

## Approaches considered
- **A (chosen)** — download the pinned onnxruntime *wheel* (PyPI CDN,
  sha256-verified), extract the `onnxruntime/` package to app-data, and prepend it to
  `sys.path` + the DLL search dir before first import. Mirrors `ModelDownloadManager`.
- **B (rejected)** — run pip/uv at runtime to install into app-data: the frozen exe
  ships no pip/uv.
- **C (rejected)** — bundle both CPU + DirectML and select at startup: on-demand was
  the explicit requirement, not bundling.

## Architecture

### Host classes
`cpu` | `directml`, chosen by `select_runtime_host_class()`:
- reuse the (now-cached) `detect_hardware()`: if `hw["gpu"]` is an NVIDIA GPU →
  `directml`; else `cpu`.
- Extension point noted for AMD/Intel DX12 later.

### `runtime_manifest`
Pinned per host class, mirroring `model_assets._GRANITE_278M_MANIFEST`:
- `RuntimeAsset(host_class, package, version, wheel_url, sha256, size_bytes)`
- `cpu` → `onnxruntime==<pin>`; `directml` → `onnxruntime-directml==<pin>`.
- Each entry pins an exact (version, `files.pythonhosted.org` wheel URL, sha256, size)
  triple — computed from the real PyPI wheels at implementation time via a documented
  refresh procedure (same pattern as the model manifest's revision pin). PyPI's hosted
  wheel files are immutable per (package, version, hash), so a pinned URL+hash can never
  silently serve different bytes.

### `RuntimeProvisioner` — `backend/services/onnx_runtime_provision.py`
Mirrors `ModelDownloadManager` (process-wide singleton; injectable `runtime_dir` +
`http_client_factory` for tests):
- `ensure(host_class)`: if `<runtime_dir>/<host_class>/` is present and valid (marker
  file records the installed version) → no-op. Else run `_provision`.
- `_provision`: mkdir/rmtree preamble **inside** the try (so a permission/disk error
  still records a terminal state, per the model-download review); stream the wheel via
  `httpx.AsyncClient(follow_redirects=True)`, sha256-verify as it streams; on full
  verify, extract the `onnxruntime/` package from the wheel zip into a temp dir;
  atomically rename temp → `<runtime_dir>/<host_class>/`. Every exception path records a
  typed `error` state and cleans the temp dir.
- `status()` → `{state: idle|detecting|downloading|verifying|extracting|done|error|cancelled,
  host, bytesDone, bytesTotal, reason}`.
- `cancel()`.

Install layout: `<app-data>/runtime/<host_class>/onnxruntime/…` plus a `<host_class>/.installed`
marker holding the version (the "already valid" check).

### `runtime_loader` — `backend/services/onnx_runtime_loader.py`
`ensure_onnxruntime_importable() -> Literal["bundled", "loaded", "missing"]`:
- If `importlib.util.find_spec("onnxruntime")` resolves (dev / venv) → `"bundled"` (no-op).
- Else compute host_class and look for `<app-data>/runtime/<host_class>/onnxruntime/`.
  If present: `os.add_dll_directory(<pkg>/capi)` + `sys.path.insert(0, <runtime_dir>/<host_class>)`,
  return `"loaded"`.
- Else `"missing"`.
- Idempotent; safe to call repeatedly. MUST run **before any `import onnxruntime`**
  (i.e. before the embedder module is first imported). Call sites: backend startup
  (`backend/main.py`) and, belt-and-suspenders, the top of `_ensure_embedder`.

### Auto-trigger + readiness
- `compute_readiness()` gains a `runtime` probe reporting `{ok, state, host}` from
  `runtime_loader` + `RuntimeProvisioner.status()`.
- When KB is enabled and the runtime is `missing`, the embedder/readiness path
  auto-starts `RuntimeProvisioner.ensure(select_runtime_host_class())` as a tracked
  background task (mirrors the fire-and-forget model download); the embedder build
  waits/retries until the runtime is `done`, then `runtime_loader` loads it and the
  embedder imports onnxruntime.
- Prerequisite ordering: **runtime → embedding model → embedder**. Readiness reflects
  both runtime and model.

### Status endpoint
`GET /api/ai/runtime/status` → `RuntimeProvisioner.status()` (mirrors
`/api/ai/models/download/status`). Frontend can poll it to show
"Downloading AI runtime (DirectML) — 40 / 68 MB". Minimal wiring only (full UX deferred).

## Build change (PyInstaller spec)
- Add `"onnxruntime"` to `Analysis(excludes=[...])` so it is **not** bundled.
- Keep `numpy` + `tokenizers` bundled (host-agnostic, small, always needed by the embedder).
- Verify the build produces no `_internal/onnxruntime/`; base installer shrinks ~35 MB.

## Dev vs packaged
- **Dev (`uv sync`)**: onnxruntime is in the venv → `runtime_loader` returns `"bundled"`
  → the provisioner never triggers. Developer workflow + tests unchanged.
- **Packaged Windows**: onnxruntime excluded → `runtime_loader` returns `"missing"` until
  provisioned → auto-download on first KB use.

## Error / offline handling
- Download/verify/extract failure → `status=error` with a typed `reason`
  (`network_error` | `checksum_mismatch` | `extract_failed` | `no_manifest`). KB stays
  unavailable; browse/translate/transcribe are unaffected. Auto-retry on next KB access;
  the user can re-trigger.
- Atomic install (rename only after full verify + extract) → a partial/corrupt runtime is
  never loaded.
- Offline first run → KB unavailable with a clear "AI runtime not downloaded" state;
  everything else works.

## Logging (complete — first-class requirement)
Every step logs via structlog, following the outbound-HTTP-boundary pattern
(status + context, never secrets — there are none here, only public wheel URLs):
- `onnx_runtime.host_detected` — host_class, gpu, vram_gb
- `onnx_runtime.provision_started` — host_class, package, version, url, size_bytes
- `onnx_runtime.download_http_status` — host_class, status, final_url — logged for any
  non-200 **before** `raise_for_status` (so a 404/redirect is visible, not a generic fail)
- `onnx_runtime.download_progress` — host_class, bytes_done, bytes_total — debug, throttled
  (every N MB), never per-chunk
- `onnx_runtime.verified` — host_class, sha256_ok=True
- `onnx_runtime.extract_started` / `onnx_runtime.extract_done` — host_class, files, dest
- `onnx_runtime.provision_complete` — host_class, version, dest, duration_s
- `onnx_runtime.provision_failed` — host_class, reason, status, error (exception string +
  HTTP status where applicable)
- `onnx_runtime.provision_cancelled` — host_class
- `runtime_loader.onnxruntime_bundled` — debug (dev no-op path)
- `runtime_loader.loaded_downloaded` — host_class, path
- `runtime_loader.runtime_missing` — host_class, expected_path
- End-to-end confirmation reuses the existing `onnx_embedder.provider_selected`
  (provider=Dml/CPU) once the embedder builds.

## Testing
**Unit** (pytest + respx + tmp dirs; mirrors `test_model_assets_download.py`):
- `select_runtime_host_class`: NVIDIA hw → `directml`; no-gpu hw → `cpu` (mock `detect_hardware`).
- `RuntimeProvisioner.ensure`: respx-mocked small **real** zip containing a stub
  `onnxruntime/` dir + matching sha256 → downloads, verifies, extracts, atomically
  installs, `status=done`; sha mismatch → `error`/`checksum_mismatch`; a 302 redirect is
  followed (`follow_redirects`); already-installed → no-op.
- `runtime_loader`: `"bundled"` when onnxruntime importable; `"loaded"` (adds `sys.path` +
  dll dir) when a fake runtime dir exists; `"missing"` otherwise.
- readiness `runtime` probe states.
- Assert the error + complete log events (the ones that gate/observe behavior).

**Target-hardware** (manual, RTX 3090): real directml wheel download → extract → load →
embed; confirm `active_provider=DmlExecutionProvider` and embeddings match CPU (embed
correctness already independently verified).

## Out of scope / follow-ups
- SetupChecklist / first-run UX redesign (separate).
- AMD/Intel DX12 → DirectML.
- CUDA / TensorRT runtimes.
- Optional "offline installer" variant that bundles the runtime for air-gapped installs.
