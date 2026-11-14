"""The suite must never reach the developer's real OS keyring.

A conftest-level guard installs a dict-backed keyring for every test, and the
pysaka credential store stays the real code on top of it (a MagicMock
``pysaka.credentials`` made results depend on which conftest imported
``backend`` first).
"""

import keyring


def test_every_test_runs_on_the_in_memory_keyring():
    assert type(keyring.get_keyring()).__name__ == "_InMemoryKeyring"


def test_the_credential_store_is_the_real_one_on_that_keyring():
    from backend.api import translation
    from pysaka import credentials

    assert translation.get_token_manager is credentials.get_token_manager
    store = translation.get_token_manager().store
    store.save("llm_provider_api_key", {"api_key": "k", "provider": "gemini"})
    assert store.load("llm_provider_api_key") == {"api_key": "k", "provider": "gemini"}


def test_a_stored_key_does_not_leak_into_the_next_test():
    from backend.api import translation

    assert translation._load_api_key() is None
    assert translation._key_status_cache is None
