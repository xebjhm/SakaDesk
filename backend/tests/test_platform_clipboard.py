import struct
from pathlib import Path
from unittest.mock import patch

import pytest


def test_copy_file_to_clipboard_not_windows():
    """On non-Windows, copy_file_to_clipboard raises RuntimeError."""
    from backend.services.platform import copy_file_to_clipboard

    with pytest.raises(RuntimeError, match="Windows"):
        copy_file_to_clipboard(Path("/some/file.mp4"))


def test_copy_file_to_clipboard_file_not_found():
    """copy_file_to_clipboard raises FileNotFoundError when file doesn't exist."""
    from backend.services.platform import copy_file_to_clipboard

    with patch("backend.services.platform.is_windows", return_value=True):
        with pytest.raises(FileNotFoundError):
            copy_file_to_clipboard(Path("/nonexistent/file.mp4"))


def test_build_dropfiles_struct():
    """DROPFILES struct has correct layout: 20-byte header + wide-char path + double null."""
    from backend.services.platform import _build_dropfiles_data

    data = _build_dropfiles_data(Path(r"C:\test\video.mp4"))

    # Header: offset (4 bytes, little-endian) = 20
    offset = struct.unpack_from("<I", data, 0)[0]
    assert offset == 20

    # fWide flag at byte 16 (4 bytes) = 1
    f_wide = struct.unpack_from("<I", data, 16)[0]
    assert f_wide == 1

    # Path starts at offset 20, encoded as UTF-16LE
    path_bytes = data[20:]
    # Should end with double null terminator (4 zero bytes for UTF-16)
    assert path_bytes.endswith(b"\x00\x00\x00\x00")

    # Decode the path (strip trailing double-null)
    decoded = path_bytes[:-2].decode("utf-16-le").rstrip("\x00")
    assert decoded == r"C:\test\video.mp4"
