"""Tests for the leaf `shutdown_state` module (C1c).

Deliberately tiny and dependency-free -- this module exists purely so
`main.py` and read paths (`search_service.build_full_index`'s spawn sites,
`backend.api.sync`'s /start and /verify) can share a single "has shutdown
begun" flag without a circular import.
"""

from backend.services import shutdown_state


def test_starts_not_shutting_down():
    shutdown_state.reset_for_tests()
    assert shutdown_state.is_shutting_down() is False


def test_begin_shutdown_flips_the_flag():
    shutdown_state.reset_for_tests()
    shutdown_state.begin_shutdown()
    assert shutdown_state.is_shutting_down() is True
    shutdown_state.reset_for_tests()


def test_begin_shutdown_is_idempotent():
    shutdown_state.reset_for_tests()
    shutdown_state.begin_shutdown()
    shutdown_state.begin_shutdown()
    assert shutdown_state.is_shutting_down() is True
    shutdown_state.reset_for_tests()


def test_reset_for_tests_restores_false():
    shutdown_state.begin_shutdown()
    shutdown_state.reset_for_tests()
    assert shutdown_state.is_shutting_down() is False
