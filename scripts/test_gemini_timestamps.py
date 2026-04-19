#!/usr/bin/env python3
"""Test Gemini transcription with timestamps using the actual provider."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.services.transcription_service import GeminiTranscriptionProvider

API_KEY = "AIzaSyAk1cEO6zutAVC-lczOjkIl3ni1S0j_Zc0"
AUDIO = Path(
    "/mnt/c/D/SakaDesk Output/日向坂46/messages/85 片山 紗希/137 片山 紗希/video/449758.mp4"
)


async def main():
    print(f"Audio: {AUDIO} ({AUDIO.stat().st_size / 1024 / 1024:.1f} MB)")

    provider = GeminiTranscriptionProvider(api_key=API_KEY)
    print(f"Model: {provider._model}")
    print("Calling Gemini...")

    full_text, segments = await provider.transcribe(
        AUDIO, member_name="片山 紗希", group_name="日向坂46"
    )

    print(f"\n=== FULL TEXT ({len(full_text)} chars) ===")
    print(full_text[:300] + "..." if len(full_text) > 300 else full_text)

    print(f"\n=== SEGMENTS ({len(segments)}) ===")
    for i, s in enumerate(segments):
        mins = int(s.start // 60)
        secs = int(s.start % 60)
        print(
            f"[{i:2d}] {mins:02d}:{secs:02d} ({s.start:6.1f}-{s.end:6.1f}) | {s.text}"
        )


asyncio.run(main())
