import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Add project root to Python path for test discovery
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.main import app  # noqa: E402


@pytest.fixture(autouse=True, scope="session")
def _isolate_machine_state(tmp_path_factory: pytest.TempPathFactory):
    """Session-wide barrier between the suite and the developer's machine.

    Points SAKADESK_DATA_DIR at a temp dir so settings.json / app DBs
    are never the real ones (platform.get_app_data_dir honors it per call).
    """
    original_data_dir = os.environ.get("SAKADESK_DATA_DIR")
    os.environ["SAKADESK_DATA_DIR"] = str(tmp_path_factory.mktemp("sakadesk-data"))

    yield

    if original_data_dir is None:
        os.environ.pop("SAKADESK_DATA_DIR", None)
    else:
        os.environ["SAKADESK_DATA_DIR"] = original_data_dir


@pytest.fixture(autouse=True)
def _no_memories_refresh(monkeypatch):
    """A completed sync schedules Memories refreshes; never scrape or scan in tests.

    Autospecced from the real functions, so a signature change at the call
    site in sync_service fails the tests instead of passing silently.
    """
    from unittest.mock import create_autospec

    from backend.services.memories.index import build_all
    from backend.services.memories.member_profiles import refresh_member_profiles

    monkeypatch.setattr(
        "backend.services.sync_service.refresh_member_profiles",
        create_autospec(refresh_member_profiles, return_value=False),
    )
    monkeypatch.setattr(
        "backend.services.sync_service.build_memory_index",
        create_autospec(build_all, return_value=0),
    )
    from backend.services.memories.album import warm_album

    monkeypatch.setattr(
        "backend.services.sync_service.warm_album",
        create_autospec(warm_album, return_value=None),
    )


@pytest.fixture(autouse=True)
def _reset_binder_bad_start_log():
    """binder logs a bad subscription start once per person per JST day;
    never let one test's log hide another's."""
    from backend.services.memories import binder

    binder.reset_bad_start_log_for_tests()
    yield


@pytest.fixture(autouse=True)
def _reset_text_memo():
    """attach_texts memoises texts per room file; never leak them between tests."""
    from backend.services.memories import people

    people.clear_text_memo()
    yield
    people.clear_text_memo()


@pytest.fixture(autouse=True)
def _reset_session_alert():
    """session_alert keeps module-level state; never leak it between tests."""
    from backend.services import session_alert

    session_alert._reset_for_tests()
    yield
    session_alert._reset_for_tests()


@pytest.fixture(autouse=True)
def _stop_thumbnail_pool():
    """The thumbnail route's IO pool is long-lived: never leave its threads alive
    into a later test that forks (multi-threaded fork warnings / deadlocks)."""
    yield
    from backend.services import photo_thumb

    photo_thumb.shutdown_io_pool()


@pytest.fixture
def client():
    """Sync TestClient for backend/tests API tests.

    backend/tests/ is a sibling of the top-level tests/ dir (which defines its
    own `client` fixture), so pytest's fixture resolution never sees that one
    here — conftest fixtures only propagate down the directory tree, not across
    siblings. This local fixture makes `client` available to tests under
    backend/tests/ directly.
    """
    return TestClient(app)


@pytest.fixture
def session_image_fetch(monkeypatch):
    """Drive blog image downloads through a mocked aiohttp session.

    ``remote_images.fetch_official_image`` checks hosts, redirects and the body
    cap (``test_remote_images.py``). Tests of the callers' own logic (file
    names, result slots, the semaphore) use this stand-in, which reads
    ``session.get(url)`` the way the code did before the host policy.
    """
    from backend.services import blog_service, remote_images

    async def fetch(session, url, *, max_bytes=remote_images.MAX_REMOTE_IMAGE_BYTES):
        async with session.get(url) as resp:
            if resp.status != 200:
                raise remote_images.RemoteImageRefused("status", status=resp.status)
            headers = resp.headers if isinstance(resp.headers, dict) else {}
            return await resp.read(), headers.get("Content-Type", "")

    monkeypatch.setattr(blog_service, "fetch_official_image", fetch)
