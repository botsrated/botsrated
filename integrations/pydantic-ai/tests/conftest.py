"""Offline tests never read a real policy token from the environment."""

from __future__ import annotations

import json

import pytest
from support import FOUND, FX


@pytest.fixture(autouse=True)
def _no_token_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BOTSRATED_TOKEN", raising=False)


@pytest.fixture
def api():
    import respx

    not_covered = json.loads((FX / "preflight-not-covered.json").read_text())
    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as mock:
        mock.get("/v1/preflight", params={"url": FOUND["host"]}).respond(200, json=FOUND)
        mock.get("/v1/preflight").respond(404, json=not_covered)
        yield mock
