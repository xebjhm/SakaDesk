"""Shared rule that decides whether a chat is a group (communal) chat.

Used by the content API and the notification planner so the two can never
disagree about what counts as a room versus a 1:1 chat.
"""

# Communal (group) chat IDs, keyed by service identifier to avoid cross-service
# collisions (group IDs are only unique within a single service's API).
#
# LOAD-BEARING — do not "simplify" this away in favour of member_count alone.
# member_count here is the number of distinct on-disk *senders* (get_member_dirs),
# NOT the API's /groups/{id}/members count. An official communal channel posts
# from a single account, so it has one sender folder and member_count == 1;
# `member_count > 1` therefore cannot detect it. The IDs below are the communal
# channels verified against real synced data (2026-07-02) that need this override:
#   hinatazaka46 43 (日向坂46), nogizaka46 45 (乃木坂46), sakurazaka46 33 (櫻坂46).
# 79/93 (hinatazaka46) also have >1 sender so member_count catches them too; they
# are listed for clarity. 78/70/73 are closed/future channels kept so they classify
# correctly if they reopen (currently no synced messages → no group emitted).
GROUP_CHAT_IDS: dict[str, set[str]] = {
    "hinatazaka46": {"43", "78", "79", "93"},
    "sakurazaka46": {"33", "73"},
    "nogizaka46": {"45", "70"},  # 70 is closed but keep for if it reopens
}


def is_group_chat(service: str, group_id: str | int, member_count: int) -> bool:
    """Return True when the chat is a group chat.

    A chat is a group chat when more than one sender folder exists, or when its
    group id is one of the known communal channels for ``service``.
    """
    return member_count > 1 or str(group_id) in GROUP_CHAT_IDS.get(service, set())
