"""attach_payment_guard registers PaymentGuard. botsrated_tools() stays free preflight only."""

from __future__ import annotations

import inspect
import json
from pathlib import Path
from typing import Any

import pytest

from langchain_botsrated import attach_payment_guard, botsrated_tools
from langchain_botsrated.attach import _remote_policy_kwargs

FX = Path(__file__).resolve().parents[3] / "fixtures"
FOUND = json.loads((FX / "preflight-found.json").read_text())
DEAD = "0x000000000000000000000000000000000000dEaD"
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"


class RecordingClientSync:
    """Stand-in for x402ClientSync. Records hooks. Signing raises."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.hooks: dict[str, Any] = {}

    def on_before_payment_creation(self, hook: Any) -> None:
        self.calls.append("before")
        self.hooks["before"] = hook

    def on_after_payment_creation(self, hook: Any) -> None:
        self.calls.append("after")
        self.hooks["after"] = hook

    def on_payment_response(self, hook: Any) -> None:
        self.calls.append("response")
        self.hooks["response"] = hook

    def register_extension(self, ext: Any) -> None:
        self.calls.append("extension")
        self.hooks["extension"] = ext

    def on_payment_creation_failure(self, hook: Any) -> None:
        self.calls.append("failure")

    def create_payment_payload(self, *_args: Any, **_kwargs: Any) -> None:
        self.calls.append("sign")
        raise AssertionError("must not sign")


def _req(pay_to: str) -> dict[str, Any]:
    return {
        "scheme": "exact",
        "network": "eip155:8453",
        "asset": USDC,
        "payTo": pay_to,
        "amount": FOUND["latest_probe"]["live_amount"],
        "maxTimeoutSeconds": 60,
        "extra": {"name": "USD Coin", "version": "2"},
    }


def _ctx(pay_to: str) -> dict[str, Any]:
    url = FOUND["latest_probe"]["url"]
    req = _req(pay_to)
    return {"payment_required": {"x402Version": 2, "resource": {"url": url}, "accepts": [req]}, "selected_requirements": req}


@pytest.fixture
def api():
    import respx

    not_covered = json.loads((FX / "preflight-not-covered.json").read_text())
    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as mock:
        mock.get("/v1/preflight", params={"url": FOUND["host"]}).respond(200, json=FOUND)
        mock.get("/v1/preflight").respond(404, json=not_covered)
        yield mock


def test_tools_factory_stays_free_preflight_only():
    assert [t.name for t in botsrated_tools()] == ["botsrated_preflight"]


def test_attach_careful_buyer_blocks_unobserved_payto(api):
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="carefulBuyer", fail_mode="open")
    assert client.calls == ["before", "after", "response", "extension"]
    assert "failure" not in client.calls and "sign" not in client.calls
    assert guard.fail_open is True
    assert guard.preset == "carefulBuyer"
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(_ctx(DEAD))
        out = client.hooks["before"](_ctx(DEAD))
    assert decision.action == "block"
    assert any(r.code == "payto_not_observed" and r.effect == "block" for r in decision.reasons)
    assert "sign" not in client.calls
    sent = " ".join(str(call.request.url) for call in api.calls)
    assert "https://botsrated.com/v1/preflight" in sent
    assert "payTo" not in sent and DEAD not in sent
    pytest.importorskip("x402")
    assert out is not None and type(out).__name__ == "AbortResult"
    assert "Payment stopped by your payment policy" in out.reason
    assert "https://botsrated.com/receipt/" in out.reason


def test_omitted_preset_does_not_block_unobserved_payto(api):
    client = RecordingClientSync()
    guard = attach_payment_guard(client)
    assert guard.fail_open is True
    assert guard.policy.pay_to_mismatch == "warn"
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(_ctx(DEAD))
    assert decision.action == "allow"
    assert any(r.code == "payto_not_observed" and r.effect == "warn" for r in decision.reasons)
    assert "sign" not in client.calls


def test_fail_mode_is_customer_chosen(api):
    opened = attach_payment_guard(RecordingClientSync(), preset="warn", fail_mode="open")
    closed = attach_payment_guard(RecordingClientSync(), preset="warn", fail_mode="closed")
    assert opened.fail_open is True
    assert closed.fail_open is False
    with pytest.raises(ValueError):
        attach_payment_guard(RecordingClientSync(), fail_mode="block")  # type: ignore[arg-type]


def test_token_is_sent_as_remote_policy_mapping(api):
    token = "policy-token-example"
    api.post("/v1/policy/check").respond(200, json={"decision": "pass"})
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", token=token)
    assert _remote_policy_kwargs(token) == {"remote_policy": {"token": token, "fail_mode": "open"}}
    assert not isinstance(guard.remote_policy, str)
    assert guard.remote_policy.token == token
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        guard.decide(_ctx(FOUND["latest_probe"]["live_payTo"]))
    preflight = [call for call in api.calls if "/v1/preflight" in str(call.request.url)]
    policy = [call for call in api.calls if "/v1/policy" in str(call.request.url)]
    assert preflight
    assert all(token not in str(call.request.url) for call in preflight)
    assert policy
    assert policy[0].request.headers["authorization"] == f"Bearer {token}"
    assert "sign" not in client.calls



def test_token_without_normalizer_raises_and_is_not_dropped(monkeypatch):
    import langchain_botsrated.attach as attach_mod

    with pytest.raises(TypeError, match="parse_remote_policy"):
        _remote_policy_kwargs("policy-token-example", normalizer=None)
    assert _remote_policy_kwargs(None, normalizer=None) == {}
    assert _remote_policy_kwargs("", normalizer=None) == {}
    monkeypatch.setattr(attach_mod, "_parse_remote_policy", lambda: None)
    client = RecordingClientSync()
    with pytest.raises(TypeError, match="token was not dropped"):
        attach_payment_guard(client, preset="warn", token="policy-token-example")
    assert client.calls == []
    # Without a token the guard still attaches on that install.
    attach_payment_guard(client, preset="warn")
    assert "before" in client.calls and "sign" not in client.calls


def test_strict_uses_the_strict_policy_table():
    from botsrated.payment_guard import POLICIES

    guard = attach_payment_guard(RecordingClientSync(), preset="strict")
    assert guard.policy is POLICIES["strict"]
    assert guard.policy is POLICIES["carefulBuyer"]


def test_attach_source_does_not_sign():
    text = Path(inspect.getfile(attach_payment_guard)).read_text()
    for needle in ("create_payment_payload", "sign_typed_data", "private_key", "eth_send", "AbortResult"):
        assert needle not in text
