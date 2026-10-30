"""Offline tests never read a real policy token from the environment."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _no_token_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BOTSRATED_TOKEN", raising=False)


@pytest.fixture(autouse=True)
def _reset_hosted_lookup_circuit():
    from botsrated.payment_guard import reset_hosted_lookup_circuit

    reset_hosted_lookup_circuit()
    yield
    reset_hosted_lookup_circuit()
