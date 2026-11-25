import pytest

from ci_env import on_ci


@pytest.mark.parametrize("value", ["true", "1", "yes", "True", "github-actions"])
def test_a_set_value_counts_as_ci(monkeypatch, value):
    monkeypatch.setenv("CI", value)
    assert on_ci() is True


@pytest.mark.parametrize("value", ["", " ", "0", "false", "False", "NO", " no "])
def test_empty_and_false_words_do_not_count_as_ci(monkeypatch, value):
    monkeypatch.setenv("CI", value)
    assert on_ci() is False


def test_an_unset_variable_is_not_ci(monkeypatch):
    monkeypatch.delenv("CI", raising=False)
    assert on_ci() is False
