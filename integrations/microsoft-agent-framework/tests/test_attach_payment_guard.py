"""attach_payment_guard registers PaymentGuard. The free check tool does not."""

from __future__ import annotations

import inspect
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx
import pytest
from support import (
    DEAD,
    OBSERVED,
    SELLER,
    TOKEN,
    RecordingClientSync,
    ctx,
    ensure_remote_policy_guard,
    policy_calls,
    policy_view,
    supports_remote_policy,
)

from agent_framework_botsrated import attach_payment_guard, botsrated_check_payment_tool
from agent_framework_botsrated.guard import _remote_policy_kwargs, build_payment_guard

_FORBIDDEN = (
    "create_payment_payload",
    "sign_typed_data",
    "private_key",
    "eth_send",
    "AbortResult",
    "/v1/policy",
    "FEATURE_GUARD_POLICY",
    "class ChatAgent",
    "class Agent(",
    "StateGraph",
)


def test_attach_signature_matches_the_langchain_hook():
    sig = inspect.signature(attach_payment_guard)
    assert list(sig.parameters) == ["x402_client", "preset", "token", "fail_mode"]
    for name in ("preset", "token", "fail_mode"):
        assert sig.parameters[name].kind is inspect.Parameter.KEYWORD_ONLY
        assert sig.parameters[name].default is None
    assert "attach_payment_guard" in __import__("agent_framework_botsrated").__all__


def test_check_payment_tool_does_not_attach_a_guard():
    source = inspect.getsource(botsrated_check_payment_tool)
    assert "attach_payment_guard" not in source
    assert "payment_guard" not in source
    assert ".install(" not in source
    assert "on_before_payment_creation" not in source
    client = RecordingClientSync()
    botsrated_check_payment_tool()
    assert client.calls == []


def test_build_payment_guard_does_not_install():
    assert ".install(" not in inspect.getsource(build_payment_guard)


@pytest.mark.parametrize("preset", ["carefulBuyer", "strict"])
def test_attach_blocks_unobserved_payto_only_for_blocking_presets(api, preset: str):
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset=preset, fail_mode="open")
    assert client.calls == ["before", "after", "response", "extension"]
    assert "failure" not in client.calls and "sign" not in client.calls
    assert guard.fail_open is True
    with guard.request(SELLER):
        decision = guard.decide(ctx(DEAD))
        out = client.hooks["before"](ctx(DEAD))
    assert decision.action == "block"
    assert any(reason.code == "payto_not_observed" and reason.effect == "block" for reason in decision.reasons)
    assert "sign" not in client.calls
    for call in api.calls:
        target = str(call.request.url)
        assert target.startswith("https://botsrated.com/v1/preflight")
        assert "/v1/policy" not in target
        assert "payTo" not in target and DEAD not in target
    pytest.importorskip("x402")
    assert out is not None and type(out).__name__ == "AbortResult"
    assert "Payment stopped by your payment policy" in out.reason


def test_omitted_preset_warns_and_does_not_block_unobserved_payto(api):
    client = RecordingClientSync()
    guard = attach_payment_guard(client)
    assert guard.fail_open is True
    assert guard.preset is None
    assert guard.policy.pay_to_mismatch == "warn"
    with guard.request(SELLER):
        decision = guard.decide(ctx(DEAD))
        out = client.hooks["before"](ctx(DEAD))
    assert decision.action == "allow"
    assert any(reason.code == "payto_not_observed" and reason.effect == "warn" for reason in decision.reasons)
    assert out is None
    assert "sign" not in client.calls
    assert policy_calls(api) == []


def test_strict_uses_the_strict_policy_table():
    from botsrated.payment_guard import POLICIES

    guard = attach_payment_guard(RecordingClientSync(), preset="strict")
    assert guard.policy is POLICIES["strict"]
    assert guard.policy is POLICIES["carefulBuyer"]
    assert guard.preset is None


def test_fail_mode_defaults_open_and_closed_stops_when_preflight_is_unreachable():
    opened = attach_payment_guard(RecordingClientSync(), preset="warn", fail_mode="open")
    omitted = attach_payment_guard(RecordingClientSync(), preset="warn")
    assert opened.fail_open is True
    assert omitted.fail_open is True
    with pytest.raises(ValueError):
        attach_payment_guard(RecordingClientSync(), fail_mode="block")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        attach_payment_guard(RecordingClientSync(), preset="dry-run-only")  # type: ignore[arg-type]

    pytest.importorskip("x402")
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", fail_mode="closed")
    assert guard.fail_open is False
    import respx

    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as mock:
        mock.get("/v1/preflight").mock(side_effect=httpx.ConnectError("unreachable"))
        with guard.request(SELLER):
            decision = guard.decide(ctx(OBSERVED))
            stopped = client.hooks["before"](ctx(OBSERVED))
        sent = " ".join(str(call.request.url) for call in mock.calls)
    assert decision.action == "block"
    assert any(reason.code == "botsrated_unreachable" and reason.effect == "block" for reason in decision.reasons)
    assert stopped is not None and type(stopped).__name__ == "AbortResult"
    assert "sign" not in client.calls
    assert "/v1/policy" not in sent
    assert "https://botsrated.com/v1/preflight" in sent


def test_without_token_makes_no_remote_policy_http(api):
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn")
    with guard.request(SELLER):
        guard.decide(ctx(OBSERVED))
    assert api.calls
    for call in api.calls:
        target = str(call.request.url)
        assert target.startswith("https://botsrated.com/v1/preflight")
        assert "/v1/policy" not in target
    assert policy_view(guard) is None


def test_token_is_a_mapping_only_when_the_constructor_accepts_it():
    class WithSnake:
        def __init__(self, remote_policy: Mapping[str, str] | None = None) -> None:
            if remote_policy is not None and not isinstance(remote_policy, Mapping):
                raise TypeError("remote_policy must be a mapping")
            self.remote_policy = remote_policy

    class WithCamel:
        def __init__(self, remotePolicy: Mapping[str, str] | None = None) -> None:
            self.remotePolicy = remotePolicy

    class WithNeither:
        def __init__(self, preset: str | None = None) -> None:
            self.preset = preset

    snake = _remote_policy_kwargs(WithSnake, "abc", "closed")
    assert snake == {"remote_policy": {"token": "abc", "fail_mode": "closed"}}
    assert isinstance(snake["remote_policy"], dict)
    assert _remote_policy_kwargs(WithSnake, "abc", None) == {"remote_policy": {"token": "abc", "fail_mode": "open"}}
    assert _remote_policy_kwargs(WithCamel, "abc", "open") == {"remotePolicy": {"token": "abc", "fail_mode": "open"}}
    assert _remote_policy_kwargs(WithNeither, "abc", "closed") == {}
    assert _remote_policy_kwargs(WithSnake, None, "closed") == {}
    assert _remote_policy_kwargs(WithSnake, "", "closed") == {}
    WithSnake(**snake)
    with pytest.raises(TypeError):
        WithSnake(remote_policy="abc")  # type: ignore[arg-type]


def test_token_without_remote_policy_kwarg_does_not_call_or_raise(api):
    api.post("/v1/policy/check").respond(200, json={"decision": "pass"})
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", token=TOKEN, fail_mode="closed")
    assert not supports_remote_policy(type(guard)) or policy_view(guard) == (TOKEN, "closed")
    with guard.request(SELLER):
        decision = guard.decide(ctx(OBSERVED))
    sent = " ".join(str(call.request.url) + str(call.request.content) + str(call.request.headers) for call in api.calls)
    if not supports_remote_policy(type(guard)):
        assert TOKEN not in sent
        assert TOKEN not in repr(guard.__dict__)
        assert policy_calls(api) == []
        assert decision.action == "allow"
    else:
        assert policy_view(guard) == (TOKEN, "closed")
        assert not isinstance(guard.remote_policy, str)
    assert "sign" not in client.calls


def test_token_when_payment_guard_lacks_remote_policy_makes_no_policy_call(api, monkeypatch: pytest.MonkeyPatch):
    import botsrated.payment_guard as payment_guard

    real = payment_guard.PaymentGuard

    class LocalOnly(real):  # type: ignore[misc]
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(payment_guard, "PaymentGuard", LocalOnly)
    api.post("/v1/policy/check").respond(200, json={"decision": "block"})
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", token=TOKEN, fail_mode="closed")
    assert "remote_policy" not in inspect.signature(type(guard).__init__).parameters
    with guard.request(SELLER):
        decision = guard.decide(ctx(OBSERVED))
    sent = " ".join(str(call.request.url) + str(call.request.content) + str(call.request.headers) for call in api.calls)
    assert policy_calls(api) == []
    assert TOKEN not in sent
    assert decision.action == "allow"
    assert "sign" not in client.calls


def test_env_token_is_used_when_argument_is_omitted(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BOTSRATED_TOKEN", "env-token")
    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    if supports_remote_policy(type(guard)):
        assert policy_view(guard) == ("env-token", "open")
        assert not isinstance(guard.remote_policy, str)
    else:
        assert policy_view(guard) is None


def test_explicit_token_wins_over_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BOTSRATED_TOKEN", "env-token")
    guard = attach_payment_guard(RecordingClientSync(), token="explicit-token", fail_mode="closed")
    if supports_remote_policy(type(guard)):
        assert policy_view(guard) == ("explicit-token", "closed")
        assert not isinstance(guard.remote_policy, str)


def test_mocked_remote_block_stops_and_pass_does_not_clear_local_block(api, monkeypatch: pytest.MonkeyPatch):
    pytest.importorskip("x402")
    ensure_remote_policy_guard(monkeypatch)
    responses = [
        {"decision": "block", "decided_by": "customer"},
        {"decision": "block", "decided_by": "customer"},
        {"decision": "pass"},
    ]

    def _reply(_request: Any) -> httpx.Response:
        return httpx.Response(200, json=responses.pop(0))

    api.post("/v1/policy/check").mock(side_effect=_reply)
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", token=TOKEN, fail_mode="open")
    assert policy_view(guard) == (TOKEN, "open")
    assert not isinstance(getattr(guard, "remote_policy", None), str)
    with guard.request(SELLER):
        blocked = guard.decide(ctx(OBSERVED))
        stopped = client.hooks["before"](ctx(OBSERVED))
    assert policy_calls(api)
    policy_call = policy_calls(api)[0]
    assert str(policy_call.request.url) == "https://botsrated.com/v1/policy/check"
    assert policy_call.request.headers["authorization"] == f"Bearer {TOKEN}"
    assert "payment-signature" not in {key.lower() for key in policy_call.request.headers}
    assert blocked.action == "block"
    assert any(reason.code == "remote_policy" and reason.effect == "block" for reason in blocked.reasons)
    assert stopped is not None and type(stopped).__name__ == "AbortResult"
    assert "sign" not in client.calls

    strict = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer", token=TOKEN, fail_mode="open")
    with strict.request(SELLER):
        still = strict.decide(ctx(DEAD))
    assert responses == []
    assert still.action == "block"
    assert any(reason.code == "payto_not_observed" and reason.effect == "block" for reason in still.reasons)


@pytest.mark.parametrize(
    ("status", "body", "transport"),
    [
        (200, {"decision": None}, False),
        (503, {"decision": None}, False),
        (None, {}, True),
    ],
)
def test_fail_mode_closed_null_decision_does_not_proceed(
    api, monkeypatch: pytest.MonkeyPatch, status: int | None, body: dict[str, Any], transport: bool
):
    pytest.importorskip("x402")
    ensure_remote_policy_guard(monkeypatch)
    route = api.post("/v1/policy/check")
    if transport:
        route.mock(side_effect=httpx.ConnectError("unreachable"))
    else:
        route.respond(status, json=body)
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", token=TOKEN, fail_mode="closed")
    assert guard.fail_open is False
    assert policy_view(guard) == (TOKEN, "closed")
    with guard.request(SELLER):
        decision = guard.decide(ctx(OBSERVED))
        stopped = client.hooks["before"](ctx(OBSERVED))
    assert route.called
    assert decision.action == "block"
    assert any(reason.code == "remote_policy_unavailable" and reason.effect == "block" for reason in decision.reasons)
    assert getattr(decision, "remote_decision", None) is None
    assert stopped is not None and type(stopped).__name__ == "AbortResult"
    assert "sign" not in client.calls


def test_fail_mode_open_null_decision_is_info_and_not_a_pass(api, monkeypatch: pytest.MonkeyPatch):
    ensure_remote_policy_guard(monkeypatch)
    api.post("/v1/policy/check").respond(200, json={"decision": None})
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", token=TOKEN, fail_mode="open")
    with guard.request(SELLER):
        decision = guard.decide(ctx(OBSERVED))
        proceeded = client.hooks["before"](ctx(OBSERVED))
    assert decision.action == "allow"
    assert any(reason.code == "remote_policy_unavailable" and reason.effect == "info" for reason in decision.reasons)
    assert not any(reason.effect == "block" for reason in decision.reasons)
    assert getattr(decision, "remote_decision", None) is None
    assert proceeded is None
    assert "sign" not in client.calls


def test_default_install_section_is_at_most_15_lines():
    readme = (Path(__file__).resolve().parents[1] / "README.md").read_text()
    start = readme.index("## Default install")
    rest = readme[start:]
    nxt = rest.find("\n## ", 1)
    section = rest if nxt == -1 else rest[:nxt]
    lines = section.strip("\n").splitlines()
    assert len(lines) <= 15
    lowered = section.lower()
    assert "microsoft agent framework" in lowered
    assert "not an agent or workflow runtime" in lowered
    assert "https://botsrated.com" in section


def test_package_sources_do_not_sign_or_invent_a_runtime():
    root = Path(inspect.getfile(attach_payment_guard)).parent
    for path in root.glob("*.py"):
        text = path.read_text()
        for needle in _FORBIDDEN:
            assert needle not in text, needle
    middleware = (root / "_middleware.py").read_text()
    assert ".install(" not in middleware
    assert "build_payment_guard" in middleware
