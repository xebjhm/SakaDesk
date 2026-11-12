"""Assembles the year recap's share GIF from PNG frames the frontend rendered.

The frontend draws each frame on a canvas (``recap/share/ShareRenderer.ts``) and posts
them here as base64 PNGs in one JSON body::

    {"frames": ["<b64 png>", ...], "fps": 15, "width": 540, "height": 960,
     "durations_ms": [66, 66, 1200, ...]}   # optional, one per frame

``durations_ms`` lets a held scene be sent once with a long duration instead of as
dozens of identical frames. Without it every frame lasts ``1000 / fps`` ms.

Every frame must be a PNG (magic bytes) whose IHDR declares exactly ``width`` ×
``height``. The IHDR size is read from the raw bytes before Pillow opens the
frame: a size over Pillow's ``MAX_IMAGE_PIXELS`` (its warning band included) is
``decompression_bomb`` and any other mismatch is ``frame_size``, so a bomb never
reaches Pillow at all. Pillow's own ``DecompressionBombError`` is still mapped to
``decompression_bomb``. No ``warnings`` filter is installed: filters are
process-wide and not thread-safe, and this runs in a worker thread. The whole request has a pixel budget, ``frames × width ×
height ≤ MAX_TOTAL_PIXELS`` (160 frames at 540×960), checked before any frame is
opened, so a body of many tiny, well-compressed but large frames cannot make the
worker decode hundreds of megapixels. The GIF is written with an adaptive palette per frame,
``optimize=True`` and ``loop=0`` (loop forever). Assembly is CPU work: callers run
:func:`assemble_gif` in a worker thread.

Errors are :class:`ShareGifError` with a short code (``too_many_frames``,
``frame_size``, ...) that is safe to log and to return as the HTTP detail.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import struct
from typing import Any

from PIL import Image, UnidentifiedImageError

MAX_FRAMES = 160
MAX_BODY_BYTES = 50 * 1024 * 1024
MAX_SIDE = 1920
MAX_FPS = 60
MIN_DURATION_MS = 20
MAX_DURATION_MS = 10_000
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# The frontend's GIF is 540×960; 160 such frames is the most one request may decode.
MAX_TOTAL_PIXELS = MAX_FRAMES * 540 * 960


class ShareGifError(ValueError):
    """A rejected request; ``code`` is a log-safe reason and ``status`` the HTTP status."""

    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def _int_field(body: dict[str, Any], name: str, lo: int, hi: int, code: str) -> int:
    value = body.get(name)
    # bool is an int subclass; a JSON true is not a size.
    if not isinstance(value, int) or isinstance(value, bool) or not lo <= value <= hi:
        raise ShareGifError(code)
    return value


def _durations(body: dict[str, Any], count: int, fps: int) -> list[int]:
    raw = body.get("durations_ms")
    if raw is None:
        return [round(1000 / fps)] * count
    if not isinstance(raw, list) or len(raw) != count:
        raise ShareGifError("bad_durations")
    out: list[int] = []
    for d in raw:
        if (
            not isinstance(d, int)
            or isinstance(d, bool)
            or not MIN_DURATION_MS <= d <= MAX_DURATION_MS
        ):
            raise ShareGifError("bad_durations")
        out.append(d)
    return out


def _ihdr_size(data: bytes) -> tuple[int, int]:
    """``(width, height)`` from a PNG's IHDR chunk, read without Pillow."""
    if len(data) < 24 or data[12:16] != b"IHDR":
        raise ShareGifError("bad_frame")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def _decode_frame(raw: Any, width: int, height: int) -> Image.Image:
    if not isinstance(raw, str):
        raise ShareGifError("bad_frame")
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise ShareGifError("bad_frame") from None
    if not data.startswith(PNG_MAGIC):
        raise ShareGifError("not_png")
    w, h = _ihdr_size(data)
    limit = Image.MAX_IMAGE_PIXELS
    if limit is not None and w * h > limit:
        raise ShareGifError("decompression_bomb")
    if (w, h) != (width, height):
        raise ShareGifError("frame_size")
    try:
        img = Image.open(io.BytesIO(data), formats=["PNG"])
        img.load()
    except Image.DecompressionBombError:
        raise ShareGifError("decompression_bomb") from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise ShareGifError("bad_frame") from None
    return img.convert("RGB")


def assemble_gif(payload: bytes) -> tuple[bytes, int]:
    """Parse the JSON body and return the GIF bytes and the frame count.

    Raises :class:`ShareGifError` for any invalid input. Pure and CPU-bound.
    """
    try:
        body = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ShareGifError("bad_json") from None
    if not isinstance(body, dict):
        raise ShareGifError("bad_json")
    frames = body.get("frames")
    if not isinstance(frames, list) or not frames:
        raise ShareGifError("no_frames")
    if len(frames) > MAX_FRAMES:
        raise ShareGifError("too_many_frames")
    fps = _int_field(body, "fps", 1, MAX_FPS, "bad_fps")
    width = _int_field(body, "width", 1, MAX_SIDE, "bad_size")
    height = _int_field(body, "height", 1, MAX_SIDE, "bad_size")
    durations = _durations(body, len(frames), fps)
    # Every frame must match the declared size, so this bounds the decode up front.
    if len(frames) * width * height > MAX_TOTAL_PIXELS:
        raise ShareGifError("pixel_budget")

    images = [
        _decode_frame(f, width, height).convert(
            "P", palette=Image.Palette.ADAPTIVE, colors=256
        )
        for f in frames
    ]
    out = io.BytesIO()
    images[0].save(
        out,
        format="GIF",
        save_all=True,
        append_images=images[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )
    return out.getvalue(), len(images)
