#!/usr/bin/env python3
"""Build the Hinatazaka46 knowledge-base reference data for the KB chatbot.

Deterministic generator: encodes human-curated source-of-truth data (the 5th-gen
directional call-name matrix transcribed from the official 五期生 relay-blog table,
2025-05-26, plus a few given-name nicknames) and the extracted pair/unit list, and
emits canonical-ID-keyed JSON under data/knowledge/hinatazaka46/.

Run:  uv run python scripts/build_hinatazaka_kb.py

Outputs (regenerate any time from the literals below):
  data/knowledge/hinatazaka46/call_names.json   directional: who calls whom what
  data/knowledge/hinatazaka46/aliases.json       flat: alias -> member (resolution + mentions)
  data/knowledge/hinatazaka46/units.json         pair/unit/combi names -> members

Glossary (wikiwiki hinataword) is intentionally NOT built here — see
data/knowledge/README.md for why and the plan to extract it safely.
"""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEMBERS_FILE = ROOT / "data" / "members" / "hinatazaka.json"
OUT_DIR = ROOT / "data" / "knowledge" / "hinatazaka46"
SERVICE = "hinatazaka46"
SOURCE_DATE = "2025-05-26"  # date on the 五期生 call-name table

# --- 5th-gen surname -> full kanji name (space-stripped) for the matrix -------
FIFTH_GEN = {
    "大田": "大田美月",
    "大野": "大野愛実",
    "片山": "片山紗希",
    "蔵盛": "蔵盛妃那乃",
    "坂井": "坂井新奈",
    "佐藤": "佐藤優羽",
    "下田": "下田衣珠季",
    "高井": "高井俐香",
    "鶴崎": "鶴崎仁香",
    "松尾": "松尾桜",
}

# --- Directional call-name matrix (caller surname -> callee surname -> names) --
# Transcribed from the official 五期生 "メンバーの呼び名" table (relay blog).
# Row = caller, column = callee; the diagonal (self) is omitted.
CALL_NAMES: dict[str, dict[str, list[str]]] = {
    "大田": {
        "大野": ["まなお", "大野"],
        "片山": ["さきてぃ"],
        "蔵盛": ["ひなしゃん"],
        "坂井": ["にーたん"],
        "佐藤": ["さとうゆ"],
        "下田": ["いじゅき"],
        "高井": ["高井"],
        "鶴崎": ["にこしゃん"],
        "松尾": ["さくちゃん"],
    },
    "大野": {
        "大田": ["ピンク先生", "大田"],
        "蔵盛": ["妃那乃"],
        "坂井": ["にぃたん", "にぃな"],
        "佐藤": ["サトゥユ"],
        "下田": ["下田"],
        "鶴崎": ["世界遺産先生", "仁香ちゃん", "鶴崎さん", "にこぼーの", "ぼーの"],
    },
    "片山": {
        "大田": ["ピンク先生", "美月ちゃん"],
        "大野": ["まなみん"],
        "蔵盛": ["ひなちゃん"],
        "坂井": ["にいたん"],
        "佐藤": ["ゆうちゃん"],
        "下田": ["いずき"],
        "高井": ["りかたん"],
        "鶴崎": ["にこちゃん"],
        "松尾": ["さくちゃん"],
    },
    "蔵盛": {
        "大田": ["みづき"],
        "大野": ["まなみん", "大野ちゃん"],
        "片山": ["さきてぃ"],
        "坂井": ["にいたん"],
        "佐藤": ["優羽"],
        "下田": ["いずきち", "衣珠季"],
        "高井": ["高井ちゃん"],
        "松尾": ["さくてぃん", "桜"],
    },
    "坂井": {
        "大田": ["ピンク先生", "美月"],
        "大野": ["まなみん", "まなみぃ", "まなみんいい", "まいなみん"],
        "片山": ["うさき"],
        "蔵盛": ["ひなのん"],
        "佐藤": ["さとゆ〜", "ゆうゆう", "さとうゆ", "ゆう", "さーとぅゆ"],
        "下田": ["いずきち"],
        "高井": ["りかたん", "りかたんたん"],
        "鶴崎": ["にこちゃん", "にこちゃ〜ん", "にこしゃん"],
        "松尾": ["さくらぶりー"],
    },
    "佐藤": {
        "大野": ["大野"],
        "片山": ["さきてぃ"],
        "蔵盛": ["ひなしゃん"],
        "坂井": ["にいたん"],
        "下田": ["いずきち"],
        "高井": ["高井"],
        "鶴崎": ["にこ姉", "にこ"],
        "松尾": ["さくちゃん"],
    },
    "下田": {"大野": ["大野"], "片山": ["うさき", "さき", "紗希"], "松尾": ["松尾"]},
    "高井": {
        "大田": ["ピンク先生", "みづき", "大田", "美月", "ぴんくせんせい"],
        "大野": ["まなみん", "まなみんいい", "まなみいい", "まなみぃん"],
        "片山": ["さきてぃ", "さきてい"],
        "蔵盛": ["ひなのしゃん", "ひなしゃん", "ひなの", "ひなぁのしゃん"],
        "坂井": ["にいな", "にいたん", "にいなあ"],
        "佐藤": [
            "ゆうたん",
            "さとゆ",
            "ゆう",
            "ゆうさん",
            "ゆさん",
            "ゆたんっ",
            "ゆたん",
            "さとうゆ",
        ],
        "下田": ["イズキ", "いずき"],
        "鶴崎": [
            "にこしゃん",
            "お姉ちゃん",
            "にこぉしゃん",
            "にこぼーの",
            "にこちゃん",
        ],
        "松尾": [
            "おさく",
            "おしゃく",
            "まつさく",
            "さくらぶり〜",
            "さくラブリー",
            "桜鰤ー",
            "おしゃくしゃん",
            "おしゃくさん",
            "さくらぶりぃ〜",
            "おしゃくら",
        ],
    },
    "鶴崎": {
        "大田": ["美月", "美月しゃん", "ピンク先生"],
        "大野": ["まなみん", "マナ・プールズ", "大野愛実さん", "まなみさん"],
        "片山": ["さきてぃ", "さきさん"],
        "蔵盛": ["ひなのん"],
        "坂井": ["にぃたん"],
        "佐藤": ["ゆうちゃん", "しゃーべい先生", "ゆうたん"],
        "下田": ["いずきち"],
        "高井": ["りかたん", "りかさん"],
        "松尾": ["さくら", "おさく", "さくらぶりー", "桜鰤", "桜"],
    },
    "松尾": {
        "大田": ["みづゅ", "美月"],
        "大野": ["まなみん", "ウーパールーパー"],
        "蔵盛": ["ひな", "くらもり"],
        "坂井": ["にぃたん"],
        "佐藤": ["さとうゆ"],
        "下田": ["いずきち", "いずき"],
        "高井": ["りかたん"],
        "鶴崎": ["にこちゃん"],
    },
}

# Cross-generation call-names captured in the table's ※その他の情報 notes.
# (caller full name, callee full name, [names])
CROSS_GEN_CALLS = [
    ("大田美月", "正源司陽子", ["源さん"]),
    ("蔵盛妃那乃", "正源司陽子", ["陽子姉さん"]),
]

# Free-text relationship notes from ※その他の情報 (kept verbatim).
CALL_NAME_NOTES = [
    "片山：同期からは「さきてぃ」と呼ばれてる。",
    "大田：同期からは「みづき」と呼ばれてるが、地方組からは「ピンク先生」と呼ばれてる。",
    "高井：地方組からは「高井」と呼ばれてる。「さとゆ」は合宿時代に佐藤へ付けたあだ名。",
    "大田：正源司陽子を「源さん」と呼んでる。",
    "下田：大野からは五期生で唯一「下田」と呼ばれてる。下田は大野を「大野」と呼んでる。",
    "蔵盛：正源司陽子を「陽子姉さん」と呼んでる。",
]

# A few distinctive given-name nicknames from the hinatafan combo guide (page 262).
EXTRA_ALIASES: dict[str, list[str]] = {
    "金村美玖": ["みく"],
    "小坂菜緒": ["なお"],
    "上村ひなの": ["ひなの"],
    "髙橋未来虹": ["みくにん"],
    "山口陽世": ["ぱる"],
    "平尾帆夏": ["ほー"],
    "山下葉留花": ["はるか"],
    "正源司陽子": ["しょげ"],
    "藤嶌果歩": ["かほ"],
    "宮地すみれ": ["りなし"],
    "松尾桜": ["さく"],
}

# Pair/unit/combi list extracted from sakamichidatabase (…/hinatazaka46-pairunitname/).
# Automated extraction — member names mapped to canonical IDs below; unmatched
# (graduated members not in the current roster) are kept by name for reference.
UNITS = [
    ("きくとし", "", "pair", ["佐々木久美", "加藤史帆"], ""),
    ("としきょん", "", "pair", ["加藤史帆", "齊藤京子"], ""),
    ("くさり", "", "pair", ["佐々木久美", "潮紗理菜"], ""),
    ("Wささき", "", "pair", ["佐々木久美", "佐々木美玲"], ""),
    ("あゃめぃちゃん", "あめちゃん", "pair", ["高本彩花", "東村芽依"], ""),
    ("いちごミルク", "", "pair", ["佐々木久美", "東村芽依"], ""),
    ("共演NGコンビ", "", "pair", ["加藤史帆", "高瀬愛奈"], ""),
    ("キャン共", "きゃんとも", "pair", ["井口眞緒", "潮紗理菜"], ""),
    ("めみふぃ", "", "pair", ["柿崎芽実", "高瀬愛奈"], ""),
    ("わくわくピーナッツ", "", "pair", ["松田好花", "渡邊美穂"], ""),
    (
        "なおみく",
        "",
        "pair",
        ["小坂菜緒", "金村美玖"],
        "同い年ペア；15thシングルのセンターユニット",
    ),
    ("おみそしるコンビ", "", "pair", ["河田陽菜", "丹生明里"], ""),
    ("花ちゃんズ", "", "pair", ["富田鈴花", "松田好花"], "「まさか 偶然…」を演奏"),
    ("ゆばレタ", "ゆばとレタス", "pair", ["丹生明里", "金村美玖"], "埼玉近隣ペア"),
    ("なおこの", "", "pair", ["小坂菜緒", "松田好花"], ""),
    ("ひなひよ", "", "pair", ["河田陽菜", "濱岸ひより"], ""),
    ("わんだっふる", "", "pair", ["河田陽菜", "富田鈴花"], ""),
    ("納豆巻きコンビ", "", "pair", ["金村美玖", "松田好花"], "食の好みに基づく"),
    ("MM姉妹", "", "pair", ["宮田愛萌", "森本茉莉"], "姓と名の両方がMで始まる"),
    ("なおみほ", "", "pair", ["小坂菜緒", "渡邊美穂"], ""),
    (
        "まりりん&るびー",
        "",
        "pair",
        ["富田鈴花", "松田好花"],
        "ドラマ「DASADA」ユニット",
    ),
    ("ひなこの", "", "pair", ["河田陽菜", "松田好花"], "元：鎌クローバー"),
    ("バチバチコンビ", "ぱるみくにん", "pair", ["髙橋未来虹", "山口陽世"], ""),
    ("相棒コンビ", "", "pair", ["平尾帆夏", "山下葉留花"], "同い年ペア"),
    ("源平合戦", "", "pair", ["正源司陽子", "平尾帆夏"], ""),
    ("しょげかほ", "", "pair", ["正源司陽子", "藤嶌果歩"], "同い年ペア"),
    ("はるおか", "", "pair", ["山下葉留花", "平岡海月"], ""),
    ("みつきら", "", "pair", ["竹内希来里", "平岡海月"], ""),
    ("りおなな", "", "pair", ["清水理央", "小西夏菜実"], "同い年ペア"),
    (
        "渡辺莉奈親衛隊",
        "",
        "pair",
        ["平岡海月", "宮地すみれ"],
        "4期生最年少メンバーを支援",
    ),
    (
        "能ある少女はスカート揺らす",
        "能スカ",
        "pair",
        ["宮地すみれ", "渡辺莉奈"],
        "姉妹のように親しいペア",
    ),
    ("なおみくにん", "", "pair", ["小坂菜緒", "髙橋未来虹"], "2期生×3期生"),
    ("ドリアンミルク", "", "pair", ["佐々木久美", "富田鈴花"], "1期生×2期生"),
    ("なおなの", "", "pair", ["小坂菜緒", "上村ひなの"], "2期生×3期生"),
    ("やまはる", "", "pair", ["山口陽世", "山下葉留花"], "3期生×4期生"),
    ("代官山姉妹", "", "pair", ["潮紗理菜", "金村美玖"], "1期生×2期生"),
    ("チーム鳥取", "", "pair", ["山口陽世", "平尾帆夏"], "同じ県・高校・学年"),
    ("busines's", "びじねぇず", "pair", ["影山優佳", "宮田愛萌"], ""),
    ("自然姉妹", "ネイチャーズ", "pair", ["松田好花", "森本茉莉"], ""),
    ("ハタチズ", "", "pair", ["影山優佳", "河田陽菜"], "1期生×2期生、2001年生まれ"),
    (
        "まなまなコンビ",
        "",
        "pair",
        ["高瀬愛奈", "宮田愛萌"],
        "両メンバーの名前に「真」が含まれる",
    ),
    ("ファンタジー界隈", "", "pair", ["上村ひなの", "山下葉留花"], ""),
    ("AB型同盟", "", "trio", ["井口眞緒", "丹生明里", "上村ひなの"], "血液型テーマ"),
    ("ごりごりドーナッツ", "", "trio", ["富田鈴花", "松田好花", "渡邊美穂"], ""),
    (
        "カラーチャート",
        "埼玉トリオ",
        "trio",
        ["金村美玖", "丹生明里", "渡邊美穂"],
        "6thシングル曲",
    ),
    (
        "FACTORY",
        "",
        "trio",
        ["東村芽依", "河田陽菜", "松田好花"],
        "ドラマ「DASADA」ユニット",
    ),
    ("彩シス", "あやしす", "trio", ["高本彩花", "石塚瑶季", "清水理央"], ""),
    (
        "wisTar",
        "うぃすたー",
        "trio",
        ["河田陽菜", "上村ひなの", "小西夏菜実"],
        "平尾帆夏が特番のため制作",
    ),
    ("河田男前軍団", "", "trio", ["河田陽菜", "髙橋未来虹", "山下葉留花"], ""),
    (
        "きずなーず",
        "",
        "trio",
        ["加藤史帆", "齊藤京子", "佐々木美玲"],
        "1期生ボーカル3人",
    ),
    (
        "3K",
        "",
        "trio",
        ["金村美玖", "河田陽菜", "小坂菜緒"],
        "姓がKで始まる；14thシングル曲",
    ),
    (
        "末っ子むすび",
        "",
        "trio",
        ["正源司陽子", "藤嶌果歩", "渡辺莉奈"],
        "4期生最年少ユニット；14thシングル曲",
    ),
    (
        "チョコラショコラ",
        "",
        "trio",
        ["東村芽依", "河田陽菜", "濱岸ひより"],
        "ドラマ「声春っ!」声優ユニット",
    ),
    (
        "2002年組",
        "",
        "trio",
        ["金村美玖", "小坂菜緒", "濱岸ひより"],
        "2期生最年少；7thシングル曲",
    ),
    (
        "末っ子まりん",
        "",
        "trio",
        ["大野愛実", "坂井新奈", "高井俐香"],
        "5期生最年少ユニット",
    ),
    (
        "日向坂アニメ部",
        "",
        "unit",
        ["小西夏菜実", "正源司陽子", "平尾帆夏", "渡辺莉奈"],
        "テレビ番組キャスト",
    ),
    (
        "日向坂バレー部",
        "",
        "unit",
        ["小坂菜緒", "河田陽菜", "髙橋未来虹", "清水理央"],
        "",
    ),
    (
        "気難6",
        "",
        "unit",
        ["金村美玖", "小坂菜緒", "小西夏菜実", "清水理央", "竹内希来里", "渡辺莉奈"],
        "平岡海月が近づきやすくないと考えるメンバー",
    ),
    (
        "山口家連れ込み隊",
        "",
        "unit",
        ["山口陽世", "石塚瑶季", "平尾帆夏", "竹内希来里"],
        "",
    ),
    (
        "はむちゃんちっく",
        "",
        "unit",
        ["上村ひなの", "森本茉莉", "平尾帆夏", "平岡海月", "山下葉留花"],
        "名前がHまたはMで始まる",
    ),
]


def norm(name: str) -> str:
    return unicodedata.normalize("NFKC", name).replace(" ", "").replace("　", "")


def load_registry() -> dict[str, dict]:
    data = json.loads(MEMBERS_FILE.read_text(encoding="utf-8"))
    by_name: dict[str, dict] = {}
    for m in data["members"]:
        entry = {
            "canonical_id": f"{SERVICE}:{m['blogId']}",
            "name": m["nameKanji"],
            "blog_id": m["blogId"],
            "generation": m["generation"],
            "status": m["status"],
        }
        by_name[norm(m["nameKanji"])] = entry
    return by_name


def resolve(full_name: str, reg: dict[str, dict]) -> dict | None:
    return reg.get(norm(full_name))


def build_call_names(reg: dict[str, dict]) -> dict:
    edges = []
    for caller_sn, row in CALL_NAMES.items():
        caller = resolve(FIFTH_GEN[caller_sn], reg)
        for callee_sn, names in row.items():
            callee = resolve(FIFTH_GEN[callee_sn], reg)
            edges.append(
                {
                    "caller_id": caller["canonical_id"],
                    "caller_name": caller["name"],
                    "callee_id": callee["canonical_id"],
                    "callee_name": callee["name"],
                    "names": names,
                }
            )
    for caller_name, callee_name, names in CROSS_GEN_CALLS:
        caller, callee = resolve(caller_name, reg), resolve(callee_name, reg)
        edges.append(
            {
                "caller_id": caller["canonical_id"],
                "caller_name": caller["name"],
                "callee_id": callee["canonical_id"],
                "callee_name": callee["name"],
                "names": names,
            }
        )
    return {
        "meta": {
            "group": SERVICE,
            "scope": "5th generation (五期生) + noted cross-gen",
            "source": "official 五期生 relay-blog call-name table",
            "source_date": SOURCE_DATE,
            "direction": "caller_id uses `names` to address callee_id",
        },
        "edges": edges,
        "notes": CALL_NAME_NOTES,
    }


def build_aliases(reg: dict[str, dict], call_names: dict) -> dict:
    # Aggregate every distinct name pointed AT a member (union over all callers),
    # plus the given-name extras. Bare surname/given-name forms already covered by
    # the engine's auto-seed are still included here faithfully.
    agg: dict[str, set[str]] = {}
    for edge in call_names["edges"]:
        agg.setdefault(edge["callee_id"], set()).update(edge["names"])
    for full_name, names in EXTRA_ALIASES.items():
        member = resolve(full_name, reg)
        if member:
            agg.setdefault(member["canonical_id"], set()).update(names)

    members = {}
    for cid, names in sorted(agg.items()):
        member = next(v for v in reg.values() if v["canonical_id"] == cid)
        members[cid] = {
            "canonical": member["name"],
            "blog_id": member["blog_id"],
            "aliases": sorted(names),
            "origin": "curated",
        }
    return {
        "meta": {
            "group": SERVICE,
            "source": "call-name matrix + hinatafan combo guide",
            "source_date": SOURCE_DATE,
            "note": "Distinctive nicknames keyed by canonical member id. The engine "
            "unions these with auto-derived seed aliases (kanji/kana/romaji/given-name).",
        },
        "members": members,
    }


def build_units(reg: dict[str, dict]) -> dict:
    out, unmatched = [], set()
    for name, reading, kind, members, notes in UNITS:
        resolved = []
        for mn in members:
            m = resolve(mn, reg)
            if m:
                resolved.append({"name": m["name"], "canonical_id": m["canonical_id"]})
            else:
                resolved.append({"name": mn, "canonical_id": None})
                unmatched.add(mn)
        out.append(
            {
                "unit_name": name,
                "reading": reading or None,
                "kind": kind,
                "members": resolved,
                "notes": notes or None,
            }
        )
    return {
        "meta": {
            "group": SERVICE,
            "source": "sakamichidatabase.penguinelegy.com/hinatazaka46-pairunitname/",
            "caveat": "Automated extraction; members not on the current roster (graduated "
            "1st-4th gen) are kept by name with canonical_id=null. Verify before "
            "relying on edge cases.",
            "unmatched_names": sorted(unmatched),
        },
        "units": out,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    reg = load_registry()
    call_names = build_call_names(reg)
    aliases = build_aliases(reg, call_names)
    units = build_units(reg)
    for name, obj in [
        ("call_names", call_names),
        ("aliases", aliases),
        ("units", units),
    ]:
        path = OUT_DIR / f"{name}.json"
        path.write_text(
            json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote {path.relative_to(ROOT)}")  # noqa: T201  (build script, not app code)
    n_edges = len(call_names["edges"])
    n_alias = sum(len(m["aliases"]) for m in aliases["members"].values())
    print(f"  call_names: {n_edges} directional edges")  # noqa: T201
    print(f"  aliases:    {len(aliases['members'])} members, {n_alias} aliases")  # noqa: T201
    print(
        f"  units:      {len(units['units'])} units, {len(units['meta']['unmatched_names'])} unmatched names"
    )  # noqa: T201


if __name__ == "__main__":
    main()
