"""Year recap payload builder (``backend/services/memories/recap.py``)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
import time_machine
from structlog.testing import capture_logs

from backend.services import app_state
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import recap

JST = ZoneInfo("Asia/Tokyo")
SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
KANEMURA = ("34 金村 美玖", "58 金村 美玖")
PARTIAL = datetime(2026, 12, 10, 12, 0, tzinfo=JST)  # Christmas sealed
FINAL = datetime(2027, 1, 2, 9, 0, tzinfo=JST)


# --- fixture helpers ----------------------------------------------------------


def utc(jst: str) -> str:
    """``YYYY-MM-DD HH:MM[:SS]`` in JST -> archive UTC timestamp."""
    fmt = "%Y-%m-%d %H:%M:%S" if jst.count(":") == 2 else "%Y-%m-%d %H:%M"
    local = datetime.strptime(jst, fmt).replace(tzinfo=JST)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def m(i, jst, type_="text", content="", fav=False, **extra):
    return {
        "id": i,
        "timestamp": utc(jst),
        "type": type_,
        "content": content,
        "is_favorite": fav,
        **extra,
    }


def pic(i, jst, room=KANEMURA, fav=False, ext="jpg", type_="picture"):
    folder = "picture" if type_ == "picture" else type_
    # pysaka on Windows writes backslashes; the builder must normalise them.
    media = f"messages\\{room[0]}\\{room[1]}\\{folder}\\{i}.{ext}"
    return m(i, jst, type_, fav=fav, media_file=media)


def voice(i, jst, seconds, room=KANEMURA):
    media = f"messages/{room[0]}/{room[1]}/voice/{i}.m4a"
    return m(i, jst, "voice", media_file=media, media_duration=seconds)


def filler(start_id, n, month=2, hour=12):
    out = []
    for k in range(n):
        day = 1 + k % 28
        mon = month + k // 28
        out.append(
            m(
                start_id + k,
                f"2026-{mon:02d}-{day:02d} {hour:02d}:{k % 60:02d}",
                content=f"レッスン{k}回目、がんばったよ",
            )
        )
    return out


def write_room(svc, room, msgs, letters=None):
    d = svc / "messages" / room[0] / room[1]
    d.mkdir(parents=True)
    (d / "messages.json").write_text(
        json.dumps({"member": {}, "messages": msgs}, ensure_ascii=False),
        encoding="utf-8",
    )
    if letters is not None:
        (d / "letters.json").write_text(
            json.dumps({"letters": letters}, ensure_ascii=False), encoding="utf-8"
        )
    return d


def write_subs(svc, starts):
    (svc / "memories").mkdir(exist_ok=True)
    (svc / "memories" / "subscriptions.json").write_text(
        json.dumps({"groups": {g: {"earliest_start": s} for g, s in starts.items()}}),
        encoding="utf-8",
    )


def write_closed(svc, gids):
    (svc / "sync_metadata.json").write_text(
        json.dumps({"server_groups": {g: {"state": "closed"} for g in gids}}),
        encoding="utf-8",
    )


LONG = (
    "今日は" + "とても長い日記のような文章が続きます。" * 20 + "本当に嬉しい一日でした"
)
STAR = "ずっと応援してくれて本当にありがとう。これからも一緒に歩いていこうね"

FULL_ROWS = [
    m(1, "2025-08-10 20:00", content="花火きれいだったね、また見たいな"),
    m(2, "2025-03-01 12:00", content="春が来たね"),
    m(10, "2026-01-01 00:00:07", content="あけましておめでとう！今年もよろしくね"),
    m(11, "2026-01-05 21:00", content="%%%、今日もお疲れさま。明日も頑張ろうね"),
    m(12, "2026-01-10 07:00", content="おはよう☀️今日も一日がんばろう"),
    m(13, "2026-01-20 22:00", content="%%%大好きだよ、いつもありがとう"),
    m(14, "2026-03-03 20:00", content="ありがとう、ほんとうに感謝してます"),
    pic(15, "2026-05-03 18:00"),
    m(16, "2026-05-03 18:01", content="今日の景色、見せたかったんだ"),
    pic(17, "2026-05-03 18:02"),
    pic(18, "2026-05-03 18:04"),
    m(19, "2026-06-01 20:00", content=STAR, fav=True),
    m(20, "2026-06-15 19:00", content=LONG),
    voice(21, "2026-07-20 22:30", 30.0),
    voice(22, "2026-02-14 21:00", 8.0),
    voice(23, "2026-11-01 23:00", 5.0),
    m(24, "2026-08-11 20:30", content="今年も花火を見たよ、きれいだった"),
    m(25, "2026-11-20 21:00", content="%%%に会えて嬉しかった！また会おうね"),
    m(26, "2026-04-01 23:00", content="おやすみ〜"),
    m(27, "2026-09-01 23:10", content="おやすみなさい"),
    m(28, "2026-12-05 23:30", content="今日もありがとう、おやすみ"),
    m(29, "2026-04-10 12:00", content="詳細はコチラ https://example.jp"),
    m(30, "2026-12-24 20:00", content="メリークリスマス🎄%%%"),
    m(31, "2026-12-31 23:50", content="今年もありがとう、おやすみ"),
    m(32, "2026-12-25 10:00", content="メリクリ！素敵な一日を"),
    pic(40, "2026-02-02 21:00"),
    pic(41, "2026-03-09 21:00"),
    pic(42, "2026-04-12 21:00"),
    pic(43, "2026-07-07 21:00"),
    pic(44, "2026-10-10 21:00"),
    *filler(100, 160),
]
FULL_TEXTS = [r["content"] for r in FULL_ROWS if r["content"]]
LETTERS = [
    {
        "id": 1,
        "text": "はじめてのお手紙です\n二行目",
        "created_at": "2026-03-01T10:00:00+09:00",
    },
    {"id": 2, "text": "去年の手紙", "created_at": "2025-05-01T10:00:00+09:00"},
]


@pytest.fixture
def svc(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    s = tmp_path / SVC_NAME
    s.mkdir()
    return s


@pytest.fixture
def full(svc):
    write_room(svc, KANEMURA, FULL_ROWS, letters=LETTERS)
    write_subs(svc, {"34": "2024-07-24"})
    return svc


async def summary_of(svc, name_norm):
    members = await mi.list_members(svc)
    return next(s for s in members if s.name_norm == name_norm)


async def build(svc, name_norm, when, year=2026):
    with time_machine.travel(when, tick=False):
        summary = await summary_of(svc, name_norm)
        return await recap.build_member_recap(
            SERVICE, svc, summary, year, now=datetime.now(timezone.utc)
        )


def slides_of(payload):
    return {s["key"]: s for s in payload["slides"]}


def hero_keys(payload):
    """(member_path, id) of every message that is a slide's hero."""
    out = []
    s = slides_of(payload)

    def add(msg):
        if msg:
            out.append((msg["member_path"], msg["id"]))

    if "s01_first" in s:
        add(s["s01_first"]["data"]["message"])
    if "s02_name" in s:
        add(s["s02_name"]["data"]["first"])
        add(s["s02_name"]["data"]["last"])
    if "s03_clock" in s:
        add(s["s03_clock"]["data"]["representative"])
    if "s04_greetings" in s:
        add(s["s04_greetings"]["data"]["first_ohayo"])
        add(s["s04_greetings"]["data"]["latest_oyasumi"])
    if "s05_photos" in s:
        for b in s["s05_photos"]["data"]["burst"]:
            add(b)
        add(s["s05_photos"]["data"].get("best_photo"))
    if "s06_voice" in s:
        for c in s["s06_voice"]["data"]["clips"]:
            add(c["message"])
    if "s07_letter" in s:
        add(s["s07_letter"]["data"]["message"])
    if "s08_echo" in s:
        add(s["s08_echo"]["data"]["now"])
    if "s09_special" in s:
        for st in s["s09_special"]["data"]["stubs"]:
            add(st["message"])
    if "s11_daisuki" in s:
        add(s["s11_daisuki"]["data"]["final"])
    if "s12_sentence" in s:
        d = s["s12_sentence"]["data"]
        out.append((d["member_path"], d["message_id"]))
    if "s13_oyasumi" in s:
        add(s["s13_oyasumi"]["data"]["message"])
    return out


# --- pure rules -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("count", "tier"),
    [
        (150, "full"),
        (149, "standard"),
        (30, "standard"),
        (29, "short"),
        (10, "short"),
        (9, "none"),
        (0, "none"),
    ],
)
def test_tier_thresholds(count, tier):
    assert recap.tier_for(count) == tier


@pytest.mark.parametrize(
    ("when", "phase", "xmas"),
    [
        (PARTIAL, "partial", False),
        (datetime(2026, 12, 24, 23, 59, 59, tzinfo=JST), "partial", False),
        (datetime(2026, 12, 25, 0, 0, tzinfo=JST), "partial", True),
        (datetime(2026, 12, 31, 23, 59, 59, tzinfo=JST), "partial", True),
        (datetime(2027, 1, 1, 0, 0, tzinfo=JST), "final", True),
        (FINAL, "final", True),
    ],
)
def test_phase_flags(when, phase, xmas):
    with time_machine.travel(when, tick=False):
        assert recap.phase_flags(2026, datetime.now(timezone.utc)) == (phase, xmas)


def _metrics(**vals):
    base = dict.fromkeys(recap.TITLE_ORDER, 0)
    base["first"] = None
    base.update(vals)
    return base


def _leaders(metrics, title):
    vals = {
        k: v[title]
        for k, v in metrics.items()
        if v[title] is not None
        and (v[title] >= recap.STREAK_MIN if title == "steady" else True)
        and (title == "first" or v[title] > 0)
    }
    top = max(vals.values(), default=None)
    return {k for k, v in vals.items() if v == top}


def _max_matching(metrics):
    """Brute force: the most members that can each hold a distinct led title."""
    import itertools

    members = list(metrics)
    best = 0
    for r in range(len(members), 0, -1):
        for group in itertools.combinations(members, r):
            for perm in itertools.permutations(recap.TITLE_ORDER, r):
                if all(k in _leaders(metrics, t) for k, t in zip(group, perm)):
                    return r
    return best


def _check_titles(metrics, order):
    titles = recap.assign_titles(metrics, order)
    assigned = {k: t for k, t in titles.items() if t}
    # each title at most once, each member at most one title
    assert len(set(assigned.values())) == len(assigned)
    # only true leaders (ties count) hold a title
    for k, t in assigned.items():
        assert k in _leaders(metrics, t), (k, t)
    # the leader of a title holds it or another title they lead, unless a
    # tied co-leader holds it
    for t in recap.TITLE_ORDER:
        leaders = _leaders(metrics, t)
        if leaders and t not in assigned.values():
            assert leaders <= set(assigned), t
    # as many members as possible are titled
    assert len(assigned) == _max_matching(metrics)
    # deterministic, whatever the dict order
    shuffled = dict(reversed(list(metrics.items())))
    assert recap.assign_titles(shuffled, order) == titles
    return titles


def test_titles_go_only_to_the_true_leader():
    # a leads morning and nickname; b is only second in nickname. The old
    # greedy gave b "called your name most" although a did more often.
    metrics = {
        "a": _metrics(morning=9, nickname=9),
        "b": _metrics(nickname=8),
    }
    titles = _check_titles(metrics, ["a", "b"])
    assert titles == {"a": "morning", "b": None}


def test_titles_maximise_titled_members_by_star_order():
    # a leads morning and night; b leads only morning (tie). Both get one.
    metrics = {
        "a": _metrics(morning=5, night=3),
        "b": _metrics(morning=5),
    }
    assert _check_titles(metrics, ["a", "b"]) == {"a": "night", "b": "morning"}
    # c and d tie on the only title: star order decides.
    metrics = {"c": _metrics(voice=2), "d": _metrics(voice=2)}
    assert _check_titles(metrics, ["d", "c"]) == {"d": "voice", "c": None}
    assert _check_titles(metrics, ["c", "d"]) == {"c": "voice", "d": None}


def test_titles_never_for_zero_or_a_short_streak():
    metrics = {
        "a": _metrics(steady=6, longest=10),
        "b": _metrics(steady=3, voice=0),
    }
    titles = _check_titles(metrics, ["a", "b"])
    assert titles == {"a": "longest", "b": None}
    metrics = {"a": _metrics(steady=7), "b": _metrics(steady=6)}
    assert _check_titles(metrics, ["a", "b"]) == {"a": "steady", "b": None}


def test_titles_log_counts_only():
    metrics = {"a": _metrics(morning=1), "b": _metrics()}
    with capture_logs() as logs:
        recap.assign_titles(metrics, ["a", "b"])
    crumb = next(e for e in logs if e["event"] == "recap.titles")
    assert {k: crumb[k] for k in ("members", "leaders", "titled")} == {
        "members": 2,
        "leaders": 1,
        "titled": 1,
    }
    assert set(crumb) <= {"event", "log_level", "members", "leaders", "titled"}


def test_titles_properties_on_random_rosters():
    import random

    rng = random.Random(20261110)
    for _ in range(300):
        n = rng.randint(1, 5)
        metrics = {}
        for i in range(n):
            vals = {t: rng.choice([0, 0, 1, 2, 3]) for t in recap.TITLE_ORDER}
            vals["steady"] = rng.choice([0, 3, 7, 8])
            vals["first"] = rng.choice([None, -3, -2])
            metrics[f"m{i}"] = vals
        _check_titles(metrics, list(metrics))


# --- the full member, partial phase --------------------------------------------


@pytest.mark.asyncio
async def test_full_member_partial(full):
    p = await build(full, "金村美玖", PARTIAL)
    assert p["year"] == 2026 and p["phase"] == "partial" and p["tier"] == "full"
    assert p["member"]["id"] == "58" and p["member"]["name"] == "金村 美玖"
    assert p["member"]["subscription_start"] == "2024-07-24"
    assert p["member"]["years_together"] == 3 and p["member"]["graduated"] is False
    s = slides_of(p)
    keys = [x["key"] for x in p["slides"]]
    assert keys == [k for k in recap.SLIDE_KEYS if k in s]  # contract order

    s01 = s["s01_first"]["data"]
    assert s01["message"]["id"] == 10 and s01["new_year_midnight"] is True
    assert s01["joined_this_year"] is False
    assert s01["message"]["text"] == "あけましておめでとう！今年もよろしくね"
    assert s01["message"]["ts"] == "2025-12-31T15:00:07Z"

    s02 = s["s02_name"]["data"]
    assert s02["mode"] == "nickname" and s02["count"] == 3
    assert s02["first"]["id"] == 11 and s02["last"]["id"] == 25
    assert s02["first"]["text"].startswith("%%%")  # raw, %%% kept
    assert 0 < len(s02["fragments"]) <= 24
    assert all("%%%" in f for f in s02["fragments"])

    s03 = s["s03_clock"]["data"]
    assert s03["peak_hour"] == 12 and 0 < len(s03["stars"]) <= 600
    assert s03["representative"]["text"].startswith("レッスン")

    s04 = s["s04_greetings"]["data"]
    assert s04["first_ohayo"]["id"] == 12 and s04["oyasumi_count"] == 3
    assert s04["variant"] == "oyasumi"
    # s13 holds 28 (the latest おやすみ); s04 shows the latest-at-night free one.
    assert s04["latest_oyasumi"]["id"] == 27

    s05 = s["s05_photos"]["data"]
    assert [b["id"] for b in s05["burst"]] == [15, 17, 18]
    assert s05["burst_caption"] == "今日の景色、見せたかったんだ"
    assert len(s05["wall"]) >= 5 and s05.get("best_photo") is None
    assert s05["burst"][0]["media_url"] == (
        "/api/content/media/hinatazaka46/messages/34%20%E9%87%91%E6%9D%91%20%E7%BE%8E%E7%8E%96"
        "/58%20%E9%87%91%E6%9D%91%20%E7%BE%8E%E7%8E%96/picture/15.jpg"
    )

    s06 = s["s06_voice"]["data"]
    assert [c["message"]["id"] for c in s06["clips"]] == [22, 21, 23]
    assert s06["voice_count"] == 3
    assert all(c["start"] == 0 and c["end"] <= 6 for c in s06["clips"])

    s07 = s["s07_letter"]["data"]
    assert s07["message"]["id"] == 20 and s07["char_count"] == len(LONG)

    s08 = s["s08_echo"]["data"]
    assert s08["mode"] == "echo" and s08["then"]["id"] == 1 and s08["now"]["id"] == 24
    assert s08["shared_keyword"] == "花火" and s08["years_apart"] == 1

    stubs = s["s09_special"]["data"]["stubs"]
    xmas = [st for st in stubs if st["kind"] == "christmas"]
    assert xmas == [
        {
            "kind": "christmas",
            "message": None,
            "seconds_after_midnight": None,
            "sealed": True,
        }
    ]

    s10 = s["s10_you"]["data"]
    assert s10["favorites_count"] == 1 and s10["letters_count"] == 1
    assert s10["first_favorite"]["id"] == 19 and s10["first_favorite"]["text"] is None
    assert s10["letters"] == [
        {"date": "2026-03-01", "first_line": "はじめてのお手紙です"}
    ]

    s11 = s["s11_daisuki"]["data"]
    assert s11["final"]["id"] == 13 and 3 <= len(s11["petals"]) <= 15

    s12 = s["s12_sentence"]["data"]
    assert s12["message_id"] == 19  # the fan's ★ wins over the longer message
    assert s12["sentence"] in STAR and 8 <= len(s12["sentence"]) <= 60

    s13 = s["s13_oyasumi"]["data"]
    assert s13["message"]["id"] == 28 and s13["final"] is False
    assert s13["graduated"] is False

    poster = p["poster"]
    assert [n["key"] for n in poster["numbers"]] == ["photos"]  # sparse skipped
    assert poster["best_photo"]["id"] in {15, 17, 18, 40, 41, 42, 43, 44}
    assert poster["sentence"]["message_id"] == 19
    assert len(poster["start_mid_recent"]) == 3
    assert poster["favorites_count"] == 1 and poster["letters_count"] == 1
    assert poster["years_together"] == 3 and poster["avatar_changed"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("logged", "expected"),
    [
        (None, None),  # never logged: the message time is not the star time
        ("not-a-time", None),  # unparseable log: still no star time
        ("2026-06-01T20:00:00", None),  # naive: not a trustworthy instant
        ("2026-06-03T10:30:00+09:00", "2026-06-03T01:30:00Z"),
    ],
)
async def test_first_favorite_time_only_when_recorded(
    full, monkeypatch, logged, expected
):
    def fake_favorited_at(service, ids):
        return {19: logged} if logged is not None else {}

    monkeypatch.setattr(app_state, "favorited_at", fake_favorited_at)
    with capture_logs() as logs:
        p = await build(full, "金村美玖", PARTIAL)
    first = slides_of(p)["s10_you"]["data"]["first_favorite"]
    assert first["id"] == 19
    assert first["favorited_at"] == expected
    unparsed = [e for e in logs if e.get("rule") == "fav_at_unparsed"]
    if logged in ("not-a-time", "2026-06-01T20:00:00"):
        assert [e["message_id"] for e in unparsed] == [19]
    else:
        assert unparsed == []


@pytest.mark.asyncio
async def test_messages_are_the_hero_of_one_slide_only(full):
    for when in (PARTIAL, FINAL):
        p = await build(full, "金村美玖", when)
        keys = hero_keys(p)
        assert len(keys) == len(set(keys)), when


@pytest.mark.asyncio
async def test_full_member_final(full):
    p = await build(full, "金村美玖", FINAL)
    assert p["phase"] == "final"
    s = slides_of(p)
    s13 = s["s13_oyasumi"]["data"]
    assert s13["message"]["id"] == 31 and s13["final"] is True
    assert s["s04_greetings"]["data"]["latest_oyasumi"]["id"] == 28
    xmas = [st for st in s["s09_special"]["data"]["stubs"] if st["kind"] == "christmas"]
    assert len(xmas) == 1 and xmas[0]["sealed"] is False
    assert xmas[0]["message"]["id"] == 32  # 30 is the latest nickname sentence
    assert s["s02_name"]["data"]["last"]["id"] == 30


# --- fallbacks -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_joined_this_year_and_first_week_echo(svc):
    rows = [
        m(1, "2026-09-30 12:00", content="まえのメッセージ"),  # before W(Y)
        m(2, "2026-10-15 20:00", content="はじめまして、よろしくね"),
        m(3, "2026-10-16 20:00", content="二日目もよろしくね"),
        *[
            m(10 + k, f"2026-11-{1 + k:02d} 19:00", content=f"今日のこと{k}")
            for k in range(12)
        ],
        m(38, "2026-11-20 19:00", content="今日は本当に楽しかった", fav=True),
        m(39, "2026-12-07 21:00", content="今週のできごと"),
        m(40, "2026-12-08 21:00", content="またあした"),  # s13's last text
    ]
    write_room(svc, KANEMURA, rows)
    write_subs(svc, {"34": "2026-10-14"})
    p = await build(svc, "金村美玖", PARTIAL)
    assert p["tier"] == "short"
    s = slides_of(p)
    s01 = s["s01_first"]
    assert s01["data"]["message"]["id"] == 2 and s01["data"]["joined_this_year"]
    assert s01["fallback"] == "joined_this_year"
    s08 = s["s08_echo"]["data"]
    assert s08["mode"] == "first_week" and s08["then"]["id"] == 3
    assert s08["now"]["id"] == 39 and s08["shared_keyword"] is None
    assert s08["years_apart"] is None  # never "0"
    s10 = s["s10_you"]["data"]
    assert s10["favorites_count"] == 1 and s10["letters_count"] is None
    assert p["member"]["years_together"] == 1


@pytest.mark.asyncio
async def test_daisuki_mode_and_best_photo(svc):
    rows = [
        *[
            m(k, f"2026-03-{1 + k:02d} 20:00", content=f"きょうの話{k}")
            for k in range(10)
        ],
        m(20, "2026-04-01 21:00", content="みんな大好きだよ"),
        m(21, "2026-06-01 21:00", content="今日も大好き！"),
        pic(30, "2026-05-01 12:00"),
        pic(31, "2026-07-01 12:00", fav=True),
    ]
    write_room(svc, KANEMURA, rows)
    p = await build(svc, "金村美玖", PARTIAL)
    s = slides_of(p)
    s02 = s["s02_name"]
    assert s02["data"]["mode"] == "daisuki" and s02["fallback"] == "daisuki"
    assert s02["data"]["count"] == 2
    s05 = s["s05_photos"]["data"]
    assert s05["burst"] == [] and s05["best_photo"]["id"] == 31
    assert "wall" not in s05 or s05["wall"] == []  # < 5 photos: no wall
    assert p["member"]["subscription_start"] is None
    assert p["member"]["years_together"] is None


@pytest.mark.asyncio
async def test_single_nickname(svc):
    rows = [
        *[
            m(k, f"2026-03-{1 + k:02d} 20:00", content=f"きょうの話{k}")
            for k in range(10)
        ],
        m(20, "2026-04-01 21:00", content="%%%、元気？"),
        m(21, "2026-04-02 21:00", content="またあした"),  # s13's last text
    ]
    write_room(svc, KANEMURA, rows)
    p = await build(svc, "金村美玖", PARTIAL)
    s02 = slides_of(p)["s02_name"]["data"]
    assert s02["mode"] == "nickname" and s02["count"] == 1 and s02["single"] is True
    assert s02["first"]["id"] == 20 and s02["last"] is None


@pytest.mark.asyncio
async def test_tier_none_has_no_slides(svc):
    rows = [m(k, f"2026-03-{1 + k:02d} 20:00", content=f"話{k}") for k in range(9)]
    rows += [
        m(50 + k, f"2026-04-{1 + k:02d} 20:00", content="詳細はコチラ https://x.jp")
        for k in range(5)
    ]  # promo never counts toward the tier
    write_room(svc, KANEMURA, rows)
    p = await build(svc, "金村美玖", PARTIAL)
    assert p["tier"] == "none" and p["slides"] == [] and p["poster"] is None


@pytest.mark.asyncio
async def test_graduated_in_year_shows_her_last_message(svc):
    room = ("20 潮 紗理菜", "22 潮 紗理菜")
    rows = [
        *[
            m(k, f"2026-01-{1 + k:02d} 20:00", content=f"きょうの話{k}")
            for k in range(12)
        ],
        m(30, "2026-03-01 23:00", content="おやすみ"),
        m(31, "2026-03-31 20:00", content="今まで本当にありがとう、ずっと大好きです"),
    ]
    write_room(svc, room, rows)
    write_closed(svc, ["20"])
    p = await build(svc, "潮紗理菜", PARTIAL)
    assert p["member"]["graduated"] is True
    s13 = slides_of(p)["s13_oyasumi"]["data"]
    assert s13["graduated"] is True and s13["message"]["id"] == 31


@pytest.mark.asyncio
async def test_graduated_in_2026_is_not_graduated_in_her_2025_recap(svc):
    room = ("20 潮 紗理菜", "22 潮 紗理菜")
    rows = [
        *[
            m(k, f"2025-02-{1 + k:02d} 20:00", content=f"きょうの話{k}")
            for k in range(12)
        ],
        m(30, "2025-11-01 23:00", content="おやすみ"),
        m(31, "2025-12-20 20:00", content="今年もありがとう"),
        *[
            m(20 + k, f"2026-01-{1 + k:02d} 20:00", content=f"きょうの話{k}")
            for k in range(10)
        ],
        m(40, "2026-03-31 20:00", content="今まで本当にありがとう、ずっと大好きです"),
    ]
    write_room(svc, room, rows)
    write_closed(svc, ["20"])
    p = await build(svc, "潮紗理菜", PARTIAL, year=2025)
    assert p["phase"] == "final"
    s13 = slides_of(p)["s13_oyasumi"]["data"]
    assert s13["graduated"] is False and s13["message"]["id"] == 30
    p26 = await build(svc, "潮紗理菜", PARTIAL)
    s13_26 = slides_of(p26)["s13_oyasumi"]["data"]
    assert s13_26["graduated"] is True and s13_26["message"]["id"] == 40


def _plain(n, month=3):
    return [
        m(100 + k, f"2026-{month:02d}-{1 + k:02d} 20:00", content=f"きょうの話{k}")
        for k in range(n)
    ]


@pytest.mark.asyncio
async def test_s12_skips_the_first_message_so_s01_stays_true(svc):
    rows = [
        m(1, "2026-01-02 20:00", content=STAR, fav=True),  # ★, and the first
        *_plain(10),
        m(50, "2026-05-01 20:00", content="今日は楽しいレッスンでした"),
        m(60, "2026-06-01 20:00", content="またあした"),
    ]
    write_room(svc, KANEMURA, rows)
    s = slides_of(await build(svc, "金村美玖", PARTIAL))
    assert s["s01_first"]["data"]["message"]["id"] == 1
    assert s["s12_sentence"]["data"]["message_id"] == 50


@pytest.mark.asyncio
async def test_s12_skips_the_last_oyasumi_so_s13_stays_true(svc):
    rows = [
        m(1, "2026-01-02 20:00", content="はじめの一歩"),
        *_plain(10),
        m(50, "2026-05-01 20:00", content="今日は楽しいレッスンでした"),
        m(60, "2026-11-30 23:00", content=STAR + "、おやすみ", fav=True),
    ]
    write_room(svc, KANEMURA, rows)
    s = slides_of(await build(svc, "金村美玖", PARTIAL))
    assert s["s13_oyasumi"]["data"]["message"]["id"] == 60
    assert s["s12_sentence"]["data"]["message_id"] == 50


@pytest.mark.asyncio
async def test_s04_latest_oyasumi_is_latest_clock_time_of_night(svc):
    rows = [
        *_plain(10),
        m(1, "2026-02-01 01:30", content="おやすみ"),
        m(2, "2026-03-15 23:59", content="おやすみ"),
        m(3, "2026-04-01 01:30", content="おやすみなさい"),  # ties 1, more recent
        m(4, "2026-11-30 22:00", content="おやすみ〜"),  # s13's latest
    ]
    write_room(svc, KANEMURA, rows)
    s = slides_of(await build(svc, "金村美玖", PARTIAL))
    assert s["s13_oyasumi"]["data"]["message"]["id"] == 4
    s04 = s["s04_greetings"]
    assert s04["data"]["latest_oyasumi"]["id"] == 3
    assert s04["data"]["first_ohayo"] is None and s04["fallback"] == "morning"


@pytest.mark.asyncio
async def test_person_split_across_two_rooms_is_one_recap(svc):
    a = ("40 松田 好花", "64 松田 好花")
    b = ("94 松田 好花", "64 松田 好花")
    write_room(
        svc,
        a,
        [m(k, f"2026-01-{1 + k:02d} 20:00", content=f"Aの話{k}") for k in range(1, 9)],
    )
    write_room(
        svc,
        b,
        [m(k, f"2026-05-{1 + k:02d} 20:00", content=f"Bの話{k}") for k in range(1, 9)],
    )
    write_subs(svc, {"40": "2021-05-01", "94": "2024-01-10"})
    write_closed(svc, ["40"])
    p = await build(svc, "松田好花", PARTIAL)
    assert p["tier"] == "short"  # 8 + 8 non-promo messages
    assert p["member"]["subscription_start"] == "2021-05-01"
    assert p["member"]["years_together"] == 6
    s = slides_of(p)
    first = s["s01_first"]["data"]["message"]
    last = s["s13_oyasumi"]["data"]["message"]
    assert first["member_path"] == f"{SVC_NAME}/messages/{a[0]}/{a[1]}"
    assert first["id"] == 1 and first["text"] == "Aの話1"
    assert last["member_path"] == f"{SVC_NAME}/messages/{b[0]}/{b[1]}"
    assert last["text"] == "Bの話8"
    keys = hero_keys(p)
    assert len(keys) == len(set(keys))


# --- overview -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_members_overview(full, monkeypatch):
    svc = full
    write_room(
        svc,
        ("40 松田 好花", "64 松田 好花"),
        [
            m(k, f"2026-01-{1 + k:02d} 06:00", content=f"おはよう{k}")
            for k in range(1, 13)
        ],
    )
    write_room(
        svc,
        ("50 河田 陽菜", "70 河田 陽菜"),
        [m(1, "2026-02-01 20:00", content="ひとこと")],
    )

    async def fake_oshi(service):
        assert service == SERVICE
        return {"金村美玖"}

    monkeypatch.setattr(oshi_mod, "oshi_names", fake_oshi)
    with time_machine.travel(PARTIAL, tick=False):
        o = await recap.build_members_overview(
            SERVICE, svc, 2026, now=datetime.now(timezone.utc)
        )
    assert (
        o["year"] == 2026 and o["phase"] == "partial" and o["christmas_open"] is False
    )
    by_name = {x["name"]: x for x in o["members"]}
    kane = by_name["金村 美玖"]
    assert kane["member_path"] == f"{SVC_NAME}/messages/34 金村 美玖/58 金村 美玖"
    assert kane["member_id"] == "58" and kane["oshi"] is True and kane["tier"] == "full"
    assert (
        by_name["松田 好花"]["tier"] == "short"
        and by_name["松田 好花"]["oshi"] is False
    )
    assert by_name["河田 陽菜"]["tier"] == "none"
    assert by_name["河田 陽菜"]["title_key"] is None
    titles = [x["title_key"] for x in o["members"] if x["title_key"]]
    assert len(titles) == len(set(titles)) == 2
    assert all(t.startswith("recap.titles.") for t in titles)
    assert by_name["松田 好花"]["title_key"] == "recap.titles.morning"
    assert o["opening"]["star_order"][0] == "58"
    assert o["opening"]["first_message"]["member_id"] == "58"
    assert o["opening"]["first_message"]["ts"] == "2025-12-31T15:00:07Z"
    assert o["opening"]["oyasumi_total"] == 3
    for x in o["members"]:  # titles only: no ranks or values leak
        assert set(x) == {
            "member_path",
            "member_id",
            "name",
            "tier",
            "oshi",
            "title_key",
        }


# --- logs and cache --------------------------------------------------------------


@pytest.mark.asyncio
async def test_logs_carry_no_text_names_or_paths(full):
    with capture_logs() as logs:
        await build(full, "金村美玖", FINAL)
    selects = [e for e in logs if e["event"] == "recap.select"]
    assert selects, "every selection writes a breadcrumb"
    for e in selects:
        assert {"slide", "rule", "score", "fallback", "message_id"} <= set(e)
    blob = json.dumps(logs, ensure_ascii=False, default=str)
    for text in FULL_TEXTS:
        assert text not in blob
    for frag in ("%%%", "金村", "美玖", "messages/", "messages\\", "手紙", "花火"):
        assert frag not in blob, frag


@pytest.mark.asyncio
async def test_fallback_and_skip_paths_leave_breadcrumbs(svc):
    rows = [
        m(1, "2026-01-02 20:00", content="いつもありがとう"),  # s01's first
        *_plain(10),
        m(30, "2026-04-01 21:00", content="%%%、元気？"),  # single nickname
        m(40, "2026-05-01 20:00", content="またあした"),  # s13's last text
    ]
    write_room(svc, KANEMURA, rows)
    with capture_logs() as logs:
        p = await build(svc, "金村美玖", PARTIAL)
    s = slides_of(p)
    assert s["s02_name"]["data"]["last"] is None
    assert s["s11_daisuki"]["data"]["final"] is None
    assert "s04_greetings" not in s
    selects = [e for e in logs if e["event"] == "recap.select"]
    for e in selects:
        assert {"slide", "rule", "score", "fallback", "message_id"} <= set(e)
    nones = {(e["slide"], e["rule"]) for e in selects if e["fallback"] == "none"}
    assert {
        ("s02_name", "nickname_last"),
        ("s04_greetings", "first_morning"),
        ("s04_greetings", "latest_arigato"),
        ("s11_daisuki", "final"),
        ("s09_special", "newyear_none"),
    } <= nones
    assert ("s04_greetings", "skip") in {
        (e["slide"], e["rule"]) for e in selects if e["fallback"] == "skip"
    }
    blob = json.dumps(logs, ensure_ascii=False, default=str)
    for r in rows:
        assert r["content"] not in blob


@pytest.mark.asyncio
async def test_payload_is_cached_per_day(full):
    first = await build(full, "金村美玖", PARTIAL)
    with capture_logs() as logs:
        again = await build(full, "金村美玖", PARTIAL)
    assert again == first
    assert any(e["event"] == "recap.cache" and e["outcome"] == "hit" for e in logs)
    with capture_logs() as logs:
        await build(full, "金村美玖", datetime(2026, 12, 11, 12, 0, tzinfo=JST))
    assert any(e["event"] == "recap.cache" and e["outcome"] == "miss" for e in logs)


# --- years shelf ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recap_years_lists_years_with_a_recap(full):
    svc = full
    # 12 messages in 2024 after her room's subscription start: a short-tier year.
    write_room(
        svc,
        ("40 松田 好花", "64 松田 好花"),
        [m(k, f"2024-02-{1 + k:02d} 20:00", content=f"話{k}") for k in range(1, 13)],
    )
    # 12 messages in 2023, all before the subscription start: outside W(2023).
    write_room(
        svc,
        ("50 河田 陽菜", "70 河田 陽菜"),
        [m(k, f"2023-03-{1 + k:02d} 20:00", content=f"話{k}") for k in range(1, 13)],
    )
    # 9 messages in 2022: below the short tier.
    write_room(
        svc,
        ("60 佐々木 美玲", "80 佐々木 美玲"),
        [m(k, f"2022-03-{1 + k:02d} 20:00", content=f"話{k}") for k in range(1, 10)],
    )
    write_subs(svc, {"34": "2024-07-24", "40": "2024-01-10", "50": "2024-03-01"})
    with time_machine.travel(PARTIAL, tick=False), capture_logs() as logs:
        years = await recap.recap_years(svc, now=datetime.now(timezone.utc))
    # 2025 holds only two of 金村's messages (tier none); 2026 is full.
    assert years == [2024, 2026]
    crumb = next(e for e in logs if e["event"] == "recap.years")
    assert crumb["count"] == 2


@pytest.mark.asyncio
async def test_recap_years_ignores_messages_after_now(full):
    # On 2026-01-10 JST the 2026 window holds three messages: no 2026 recap yet.
    with time_machine.travel(datetime(2026, 1, 10, 12, 0, tzinfo=JST), tick=False):
        years = await recap.recap_years(full, now=datetime.now(timezone.utc))
    assert years == []


@pytest.mark.asyncio
async def test_recap_years_empty_service(svc):
    with time_machine.travel(PARTIAL, tick=False):
        assert await recap.recap_years(svc, now=datetime.now(timezone.utc)) == []


@pytest.mark.asyncio
async def test_recap_years_does_not_count_promo(svc):
    # 9 real messages plus 5 promo ones in 2024: below the short tier.
    rows = [m(k, f"2024-03-{1 + k:02d} 20:00", content=f"話{k}") for k in range(9)]
    rows += [
        m(50 + k, f"2024-04-{1 + k:02d} 20:00", content="詳細はコチラ https://x.jp")
        for k in range(5)
    ]
    write_room(svc, KANEMURA, rows)
    with time_machine.travel(PARTIAL, tick=False):
        assert await recap.recap_years(svc, now=datetime.now(timezone.utc)) == []
