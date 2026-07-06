import multiprocessing
from pathlib import Path

from backend.services.data_lock import DataDirLock


def _hold(lock_path, ready, release):
    lk = DataDirLock(Path(lock_path))
    assert lk.acquire(timeout=2.0)
    ready.set()
    release.wait(5.0)
    lk.release()


def test_second_acquire_blocks_until_first_releases(tmp_path):
    lp = tmp_path / ".write.lock"
    ready = multiprocessing.Event()
    release = multiprocessing.Event()
    p = multiprocessing.Process(target=_hold, args=(str(lp), ready, release))
    p.start()
    assert ready.wait(3.0)

    other = DataDirLock(lp)
    assert other.acquire(timeout=0.3) is False  # held by the child

    release.set()
    p.join(5.0)
    assert other.acquire(timeout=2.0) is True  # freed after child released
    other.release()


def test_crash_releases_lock(tmp_path):
    lp = tmp_path / ".write.lock"
    ready = multiprocessing.Event()
    never = multiprocessing.Event()
    p = multiprocessing.Process(target=_hold, args=(str(lp), ready, never))
    p.start()
    assert ready.wait(3.0)
    p.kill()  # die without release()
    p.join(5.0)
    other = DataDirLock(lp)
    assert other.acquire(timeout=2.0) is True  # OS released it on process death
    other.release()
