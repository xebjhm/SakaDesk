"""The recap's S08 echo matches keywords on NFKC text (``then_now.keywords_in``).

Kept out of ``test_memories_recap.py``, which pins the recap wave unchanged.
"""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
import time_machine

from backend.services import app_state
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import recap
from backend.tests import memories_archive as arch

JST = ZoneInfo("Asia/Tokyo")
SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
WHEN = datetime(2026, 12, 10, 12, 0, tzinfo=JST)


def utc(y: int, mo: int, d: int, h: int) -> str:
    local = datetime(y, mo, d, h, tzinfo=JST)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.fixture
def svc(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()

    async def no_oshi(service):
        return set()

    monkeypatch.setattr(oshi_mod, "oshi_names", no_oshi)
    s = tmp_path / SVC_NAME
    s.mkdir()
    return s


def test_recap_version_was_bumped_for_nfkc_keywords():
    assert recap.RECAP_VERSION >= "3"


@pytest.mark.asyncio
async def test_s08_echo_matches_half_width_katakana(svc):
    # Different month-day and hour: only the keyword can pair them, and the
    # earlier text spells it in half-width katakana (ﾗｲﾌﾞ -> ライブ under NFKC).
    arch.write_room(
        svc,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            arch.msg(1, utc(2025, 8, 10, 20), content="ﾗｲﾌﾞ楽しかった、ありがとう"),
            arch.msg(2, utc(2026, 3, 5, 15), content="今日のライブ最高だった"),
            arch.msg(
                4,
                utc(2026, 6, 1, 20),
                content="ずっと応援してくれて本当にありがとう。これからも一緒に歩いていこうね",
            ),  # the one sentence
            arch.msg(3, utc(2026, 11, 20, 23), content="今日もおやすみ"),  # the last
            # Enough messages for a full recap (tiers: < 10 has no slides).
            *(
                arch.msg(
                    100 + k, utc(2026, 2, 1 + k % 28, 13), content=f"レッスン{k}回目"
                )
                for k in range(40)
            ),
        ],
    )
    with time_machine.travel(WHEN, tick=False):
        (summary,) = await mi.list_members(svc)
        payload = await recap.build_member_recap(
            SERVICE, svc, summary, 2026, now=datetime.now(timezone.utc)
        )
    s08 = next(s for s in payload["slides"] if s["key"] == "s08_echo")["data"]
    assert s08["mode"] == "echo"
    assert s08["then"]["id"] == 1 and s08["now"]["id"] == 2
    assert s08["shared_keyword"] == "ライブ"
