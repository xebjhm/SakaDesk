"""A force resync must reset the message cursor but KEEP sync_metadata.json — it
holds the phone->Windows server_unread_count (read/unread cap). Deleting it made a
full resync appear to reset the read state."""

from backend.services.sync_service import SyncService


def test_reset_message_cursor_keeps_metadata(tmp_path):
    svc = SyncService(service="hinatazaka46")
    svc.service_data_dir = tmp_path
    svc.metadata_file = tmp_path / "sync_metadata.json"

    (tmp_path / "sync_state.json").write_text("{}", encoding="utf-8")
    svc.metadata_file.write_text(
        '{"server_groups": {"1": {"unread_count": 0}}}', encoding="utf-8"
    )

    svc._reset_message_cursor()

    # The cursor is cleared so every member is re-fetched...
    assert not (tmp_path / "sync_state.json").exists()
    # ...but the metadata (and its read/unread cap) is preserved.
    assert svc.metadata_file.exists()


def test_reset_message_cursor_preserves_messages_media_and_metadata(tmp_path):
    """Deep re-verify (force_resync) must wipe ONLY the per-member cursor
    (sync_state.json). Downloaded messages, media, and sync_metadata.json (the
    read/unread cap) must all survive — an earlier build deleted metadata and the
    read state "went back to unread"; deleting messages/media would be worse. This
    locks "deep resync only clears the cursor" so that class of over-deletion can't
    come back."""
    svc = SyncService(service="hinatazaka46")
    svc.service_data_dir = tmp_path
    svc.metadata_file = tmp_path / "sync_metadata.json"

    # A realistic member tree: the two state files + a member's messages.json and a
    # downloaded media file (both live in member subdirs of service_data_dir).
    (tmp_path / "sync_state.json").write_text('{"1_2": {"last_id": 99}}', encoding="utf-8")
    svc.metadata_file.write_text(
        '{"server_groups": {"1": {"unread_count": 3}}}', encoding="utf-8"
    )
    member_dir = tmp_path / "1 Member Name"
    (member_dir / "picture").mkdir(parents=True)
    messages = member_dir / "messages.json"
    messages.write_text('{"messages": [{"id": 1}]}', encoding="utf-8")
    media = member_dir / "picture" / "1.jpg"
    media.write_bytes(b"\xff\xd8jpeg")

    svc._reset_message_cursor()

    # Only the cursor is gone.
    assert not (tmp_path / "sync_state.json").exists()
    # Everything the user cares about survives untouched.
    assert svc.metadata_file.exists()
    assert messages.read_text(encoding="utf-8") == '{"messages": [{"id": 1}]}'
    assert media.read_bytes() == b"\xff\xd8jpeg"
