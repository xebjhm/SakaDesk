"""Make onnxruntime importable: from the venv (dev) or a downloaded runtime (packaged).

MUST run before any `import onnxruntime` (i.e. before the embedder module is
first imported). Idempotent.
"""
from __future__ import annotations

import importlib
import importlib.util
import os
import sys
from typing import Literal

import structlog

from backend.services.onnx_runtime_manifest import select_runtime_host_class
from backend.services.onnx_runtime_provision import get_runtime_provisioner

logger = structlog.get_logger(__name__)

LoaderResult = Literal["bundled", "loaded", "missing"]


def ensure_onnxruntime_importable() -> LoaderResult:
    try:
        if importlib.util.find_spec("onnxruntime") is not None:
            logger.debug("runtime_loader.onnxruntime_bundled")
            return "bundled"
    except (ImportError, ValueError):
        pass  # a broken partial path -> treat as not importable, fall through

    host = select_runtime_host_class()
    install = get_runtime_provisioner().install_dir(host)
    pkg = install / "onnxruntime"
    if pkg.is_dir():
        capi = pkg / "capi"
        if capi.is_dir():
            try:
                os.add_dll_directory(str(capi))
            except (OSError, AttributeError):
                pass  # non-Windows / already added
        if str(install) not in sys.path:
            sys.path.insert(0, str(install))
        importlib.invalidate_caches()
        logger.info("runtime_loader.loaded_downloaded", host_class=host, path=str(pkg))
        return "loaded"

    logger.info("runtime_loader.runtime_missing", host_class=host, expected_path=str(pkg))
    return "missing"
