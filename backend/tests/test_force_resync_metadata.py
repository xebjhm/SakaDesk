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
