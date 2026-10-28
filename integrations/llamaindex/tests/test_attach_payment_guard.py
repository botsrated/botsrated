"""attach_payment_guard registers PaymentGuard. BotsRatedToolSpec stays free preflight only."""

from __future__ import annotations

import inspect
import json
from pathlib import Path
from typing import Any

import pytest

from llama_index.tools.botsrated import BotsRatedToolSpec, attach_payment_guard
from llama_index.tools.botsrated.attach import (
    _REMOTE_POLICY_PARAMS,
    _remote_policy_kwargs,
)

FX = Path(__file__).resolve().parents[2] / "fixtures"
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


def test_tool_spec_stays_free_preflight_only():
    assert [t.metadata.name for t in BotsRatedToolSpec().to_tool_list()] == ["preflight"]
    text = Path(inspect.getfile(BotsRatedToolSpec)).read_text()
    assert "attach_payment_guard" not in text
    assert "PaymentGuard" not in text


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
    with pytest.raises(ValueError):
        attach_payment_guard(RecordingClientSync(), preset="dry-run-only")  # type: ignore[arg-type]


def test_token_is_local_only_until_remote_policy_exists(api):
    token = "policy-token-example"
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", token=token)
    params = inspect.signature(type(guard).__init__).parameters
    supported = any(name in params for name in _REMOTE_POLICY_PARAMS)
    expected: dict[str, dict[str, str]] = {}
    mapping = {"token": token, "fail_mode": "open"}
    if "remote_policy" in params:
        expected = {"remote_policy": mapping}
    elif "remotePolicy" in params:
        expected = {"remotePolicy": mapping}
    assert _remote_policy_kwargs(type(guard), token) == expected
    if supported:
        closed = {"token": token, "fail_mode": "closed"}
        assert next(iter(_remote_policy_kwargs(type(guard), token, "closed").values())) == closed
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        guard.decide(_ctx(FOUND["latest_probe"]["live_payTo"]))
    sent = " ".join(str(call.request.url) + str(call.request.content) for call in api.calls)
    assert token not in sent
    if not supported:
        assert token not in repr(guard.__dict__)


def test_strict_uses_the_strict_policy_table():
    from botsrated.payment_guard import POLICIES

    guard = attach_payment_guard(RecordingClientSync(), preset="strict")
    assert guard.policy is POLICIES["strict"]
    assert guard.policy is POLICIES["carefulBuyer"]


def test_attach_source_does_not_sign():
    text = Path(inspect.getfile(attach_payment_guard)).read_text()
    for needle in ("create_payment_payload", "sign_typed_data", "private_key", "eth_send", "AbortResult"):
        assert needle not in text
