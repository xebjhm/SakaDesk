# Windows Upgrade Test Plan — in-place upgrade file lock

Manual test plan for the fix that prevents **`DeleteFile failed; code 5`
(ACCESS_DENIED)** on `…\SakaDesk\_internal\libffi-8.dll` during an in-place
upgrade. This can't run in Linux CI — it needs a real Windows machine.

**Fix under test (PR #9):**
- `desktop.py` holds a named mutex `SakaDeskInstanceMutex` for the whole process
  lifetime (child workers are killed before `os._exit`, so the mutex clearing
  means the entire process tree is gone).
- `setup.iss` adds `AppMutex=SakaDeskInstanceMutex` + a `PrepareToInstall()` loop
  that waits up to ~12 s for that mutex to clear **before** the `[Files]` step.

---

## ⚠️ Read first: the fix only fully protects *fix→fix* upgrades

Both halves must be present: the **running** app must hold the mutex AND the
**installer** must wait for it. A version installed *before* this fix (e.g.
0.3.0) holds no mutex, so on the **0.3.0 → 0.3.1** upgrade `CheckForMutexes`
finds nothing, doesn't wait, and **can still throw code 5**. Protection kicks in
from **0.3.1 → 0.3.2 onward**.

**Decision point:** to protect the very next (old→new) upgrade too, add a
**version-independent process wait** (poll until `SakaDesk.exe` is gone, not just
the mutex). Decide this *before* releasing 0.3.1. See scenario 8.

---

## Prerequisites

- Windows **10 and 11** (a VM is ideal — snapshot before each run so you can reset).
- Installers:
  - [ ] **OLD** = released **0.3.0** (from GitHub Releases) — no mutex.
  - [ ] **NEW** = a build of `dev` with the fix, version e.g. `0.3.1`.
  - [ ] **NEW2** = a second fixed build, version e.g. `0.3.2` (needed for fix→fix).
  - Build via a prerelease tag, the build workflow, or locally
    (PyInstaller + `iscc setup.iss /DAppVersion=0.3.1`).
- Tools:
  - [ ] Sysinternals **`handle.exe`** / Process Explorer (inspect the mutex and
        who holds `libffi-8.dll`).
  - [ ] Task Manager.
  - Run each installer with **`/LOG=C:\inst.log`** to capture `PrepareToInstall`
        timing and every file operation.
  - App logs: `%LOCALAPPDATA%\SakaDesk\logs\`.

---

## Scenarios

### 1. Mutex sanity
- [ ] Launch NEW. `handle.exe SakaDeskInstanceMutex` → held by `SakaDesk.exe`.
- [ ] Close the app → the handle disappears (count 0).

### 2. Core race — fix→fix (the actual fix)
- [ ] Install NEW, launch it.
- [ ] Run **NEW2** while it's running.
- [ ] Expect: brief pause (waiting on mutex) → app closes → files replace →
      **no "code 5"** → app relaunches.
- [ ] **Repeat ≥10×** (the bug was intermittent; one pass proves nothing).

### 3. Amplified race — busy / slow shutdown (highest value)
- [ ] Install NEW, launch, **start a transcription or translation** (spins up
      ProcessPoolExecutor workers holding `libffi`).
- [ ] Immediately trigger the upgrade to NEW2.
- [ ] Expect: still no code 5 — recreates the original lingering-DLL condition
      and exercises "kill children before releasing the mutex".
- [ ] Repeat ≥10×.

### 4. Real user path — in-app silent upgrade
- [ ] Trigger via the app's **Check for updates → install** (`/SILENT`
      `launch_installer` flow), not a manual double-click.
- [ ] Expect: seamless upgrade + relaunch, no dialog.

### 5. Regression — fresh install
- [ ] Clean machine (or post-uninstall) → run NEW.
- [ ] Expect: **no `PrepareToInstall` delay** (no mutex present) and a normal
      install.

### 6. Regression — normal flows
- [ ] Manual upgrade with the app **not** running → no delay, works.
- [ ] **Uninstall** still works (its Sleep/retry path is unchanged).
- [ ] Post-install **relaunch** works.
- [ ] Launch the app **twice** → both launch (the mutex is create-only; verify it
      did NOT become an accidental single-instance lock).

### 7. Edge — hung app
- [ ] Freeze the app (debugger break / hung shutdown), run the installer.
- [ ] Expect: `PrepareToInstall` waits **~12 s then proceeds** (bounded, not an
      infinite hang); if still locked, the retry dialog appears (graceful).

### 8. The caveat, verified — old→new
- [ ] Install OLD **0.3.0**, launch, run NEW.
- [ ] Expect: **may still show "code 5"** (0.3.0 holds no mutex).
- [ ] Decision: accept as documented, or implement the version-independent
      process wait (see top).

---

## Pass criteria

- [ ] Scenarios **2–4**: **0** code-5 failures across ≥10 cycles each, on **both**
      Win10 and Win11.
- [ ] Scenarios **5–6**: no added delay, no broken flow, no accidental
      single-instance lock.
- [ ] Scenario **7**: bounded ~12 s wait, graceful fallback.
- [ ] Scenario **8**: behavior documented → decision made on the process wait.

## Confirm the mechanism actually engaged (not luck)

- [ ] Inno `/LOG` shows a delay at `PrepareToInstall` and **no** failed DeleteFile.
- [ ] Process Explorer: `SakaDesk.exe` + children vanish **before** the
      `_internal` files are replaced.
- [ ] App log shows the full graceful-shutdown sequence completing before the
      file copy.
