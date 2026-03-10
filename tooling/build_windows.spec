
# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all
from pathlib import Path
import os

block_cipher = None

project_root = Path(SPECPATH).parent.resolve()

datas = [
    (str(project_root / 'frontend' / 'dist'), 'frontend/dist'),
]
binaries = []
hiddenimports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'keyring.backends.Windows',
    'win32ctypes.core',
]

# Auto-collect packages
# IMPORTANT: Any new dependency MUST be added here, especially if it is
# lazy-imported (imported inside a function rather than at module top level).
# PyInstaller only traces top-level imports automatically. Lazy imports are
# invisible to static analysis and will cause "module not found" errors at
# runtime in the built exe. Packages with bundled data files (like pykakasi's
# .db dictionaries) also need collect_all() to include those data files.
packages_to_collect = [
    'fastapi',
    'starlette',
    'uvicorn',
    'pydantic',
    'pydantic_core',
    'pyhako',
    'playwright',
    'aiofiles',
    'keyring',
    'backend',
    'structlog',
    'pykakasi',
    'jaconv',
]

for pkg in packages_to_collect:
    tmp_ret = collect_all(pkg)
    datas += tmp_ret[0]
    binaries += tmp_ret[1]
    hiddenimports += tmp_ret[2]

# Ensure no duplicates in hiddenimports
hiddenimports = list(set(hiddenimports))

a = Analysis(
    [str(project_root / 'desktop.py')],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='HakoDesk',
    debug=True,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(project_root / 'tooling' / 'windows' / 'HakoDesk.ico'),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='HakoDesk',
)
