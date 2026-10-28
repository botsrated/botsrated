"""attach_payment_guard registers PaymentGuard on an x402 client. Preflight tools stay unguarded."""

from __future__ import annotations

import inspect
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from botsrated_openai_agents import attach_payment_guard, botsrated_preflight_tools
from botsrated_openai_agents.guard import _REMOTE_POLICY_PARAMS, _remote_policy_kwargs

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


class RecordingClient:
    """Stand-in for async x402Client. Class name does not end with Sync."""

    def __init__(self) -> None:
        self.hooks: dict[str, Any] = {}

    def on_before_payment_creation(self, hook: Any) -> None:
        self.hooks["before"] = hook

    def on_after_payment_creation(self, hook: Any) -> None:
        self.hooks["after"] = hook

    def on_payment_response(self, hook: Any) -> None:
        self.hooks["response"] = hook

    def register_extension(self, ext: Any) -> None:
        self.hooks["extension"] = ext


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


def test_package_does_not_replace_the_agents_sdk():
    import botsrated_openai_agents as pkg

    assert not hasattr(pkg, "Agent")
    assert not hasattr(pkg, "Runner")
    assert "attach_payment_guard" in pkg.__all__


def test_preflight_tools_do_not_attach_a_guard():
    client = RecordingClientSync()
    free = botsrated_preflight_tools()
    assert client.calls == []
    assert free.mcp_url == "https://botsrated.com/mcp"
    assert [fn.__name__ for fn in free.http] == ["botsrated_preflight"]
    text = Path(inspect.getfile(botsrated_preflight_tools)).read_text()
    assert "attach_payment_guard" not in text
    assert "on_before_payment_creation" not in text
    assert ".install(" not in text


def test_preflight_tool_is_free_http_only(api):
    out = json.loads(botsrated_preflight_tools().http[0](FOUND["latest_probe"]["url"]))
    assert out["covered"] is True
    assert out["last_probe"]["receipt_url"].startswith("https://botsrated.com/receipt/")
    sent = " ".join(str(call.request.url) for call in api.calls)
    assert "https://botsrated.com/v1/preflight" in sent
    assert "/v1/check" not in sent and "/v1/policy" not in sent
    assert "payTo" not in sent and DEAD not in sent


@pytest.mark.parametrize("preset", ["carefulBuyer", "strict"])
def test_attach_blocks_unobserved_payto_only_for_blocking_presets(api, preset: str):
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset=preset, fail_mode="open")
    assert client.calls == ["before", "after", "response", "extension"]
    assert "failure" not in client.calls and "sign" not in client.calls
    assert guard.fail_open is True
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(_ctx(DEAD))
        out = client.hooks["before"](_ctx(DEAD))
    assert decision.action == "block"
    assert any(r.code == "payto_not_observed" and r.effect == "block" for r in decision.reasons)
    assert "sign" not in client.calls
    sent = " ".join(str(call.request.url) for call in api.calls)
    assert "https://botsrated.com/v1/preflight" in sent
    assert "/v1/policy" not in sent
    assert "payTo" not in sent and DEAD not in sent
    pytest.importorskip("x402")
    assert out is not None and type(out).__name__ == "AbortResult"
    assert "Payment stopped by your payment policy" in out.reason


def test_omitted_preset_does_not_block_unobserved_payto(api):
    client = RecordingClientSync()
    guard = attach_payment_guard(client)
    assert guard.fail_open is True
    assert guard.preset is None
    assert guard.policy.pay_to_mismatch == "warn"
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(_ctx(DEAD))
        out = client.hooks["before"](_ctx(DEAD))
    assert decision.action == "allow"
    assert any(r.code == "payto_not_observed" and r.effect == "warn" for r in decision.reasons)
    assert out is None
    assert "sign" not in client.calls


def test_strict_uses_the_strict_policy_table():
    from botsrated.payment_guard import POLICIES

    guard = attach_payment_guard(RecordingClientSync(), preset="strict")
    assert guard.policy is POLICIES["strict"]
    assert guard.policy is POLICIES["carefulBuyer"]
    assert guard.preset is None


def test_async_client_gets_async_hooks():
    client = RecordingClient()
    attach_payment_guard(client, preset="warn")
    assert inspect.iscoroutinefunction(client.hooks["before"])
    assert inspect.iscoroutinefunction(client.hooks["after"])
    assert inspect.iscoroutinefunction(client.hooks["response"])


def test_fail_mode_is_customer_chosen():
    opened = attach_payment_guard(RecordingClientSync(), preset="warn", fail_mode="open")
    closed = attach_payment_guard(RecordingClientSync(), preset="warn", fail_mode="closed")
    omitted = attach_payment_guard(RecordingClientSync(), preset="warn")
    assert opened.fail_open is True
    assert omitted.fail_open is True
    assert closed.fail_open is False
    with pytest.raises(ValueError):
        attach_payment_guard(RecordingClientSync(), fail_mode="block")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        attach_payment_guard(RecordingClientSync(), preset="dry-run-only")  # type: ignore[arg-type]


def test_fail_mode_closed_null_decision_does_not_proceed():
    """No hosted decision (transport failure) must not be turned into a pass when fail_mode is closed."""
    pytest.importorskip("x402")
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", fail_mode="closed")
    import respx

    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as mock:
        route = mock.get("/v1/preflight").mock(side_effect=httpx.ConnectError("unreachable"))
        url = FOUND["latest_probe"]["url"]
        pay_to = FOUND["latest_probe"]["live_payTo"]
        with guard.request(url):
            decision = guard.decide(_ctx(pay_to))
            stopped = client.hooks["before"](_ctx(pay_to))
        sent = " ".join(str(call.request.url) for call in mock.calls)
    assert route.called
    assert decision.action == "block"
    assert any(r.code == "botsrated_unreachable" and r.effect == "block" for r in decision.reasons)
    assert stopped is not None and type(stopped).__name__ == "AbortResult"
    assert "sign" not in client.calls
    assert "/v1/policy" not in sent
    assert "https://botsrated.com/v1/preflight" in sent


def test_omitted_fail_mode_allows_when_preflight_is_unreachable():
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn")
    import respx

    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as mock:
        mock.get("/v1/preflight").mock(side_effect=httpx.ConnectError("unreachable"))
        url = FOUND["latest_probe"]["url"]
        with guard.request(url):
            decision = guard.decide(_ctx(FOUND["latest_probe"]["live_payTo"]))
            proceeded = client.hooks["before"](_ctx(FOUND["latest_probe"]["live_payTo"]))
    assert guard.fail_open is True
    assert decision.action == "allow"
    assert any(r.code == "botsrated_unreachable" and r.effect == "info" for r in decision.reasons)
    assert proceeded is None
    assert "sign" not in client.calls


def test_without_token_makes_no_remote_policy_http(api):
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn")
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        guard.decide(_ctx(FOUND["latest_probe"]["live_payTo"]))
    assert api.calls
    for call in api.calls:
        target = str(call.request.url)
        assert target.startswith("https://botsrated.com/v1/preflight")
        assert "/v1/policy" not in target
        assert "policy" not in target


def test_token_is_forwarded_only_when_the_constructor_accepts_it():
    class WithSnake:
        def __init__(self, remote_policy: str | None = None) -> None:
            del remote_policy

    class WithCamel:
        def __init__(self, remotePolicy: str | None = None) -> None:
            del remotePolicy

    class WithNeither:
        def __init__(self, preset: str | None = None) -> None:
            del preset

    assert _remote_policy_kwargs(WithSnake, "abc") == {"remote_policy": {"token": "abc", "fail_mode": "open"}}
    assert _remote_policy_kwargs(WithCamel, "abc", "closed") == {"remotePolicy": {"token": "abc", "fail_mode": "closed"}}
    assert _remote_policy_kwargs(WithNeither, "abc") == {}
    assert _remote_policy_kwargs(WithSnake, None) == {}


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
    assert _remote_policy_kwargs(type(guard), None) == {}
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        guard.decide(_ctx(FOUND["latest_probe"]["live_payTo"]))
    sent = " ".join(str(call.request.url) + str(call.request.content) + str(call.request.headers) for call in api.calls)
    assert token not in sent
    assert "/v1/policy" not in sent
    if not supported:
        assert token not in repr(guard.__dict__)


def test_attach_source_does_not_sign_or_call_remote_policy():
    text = Path(inspect.getfile(attach_payment_guard)).read_text()
    for needle in ("create_payment_payload", "sign_typed_data", "private_key", "eth_send", "AbortResult", "/v1/policy"):
        assert needle not in text
