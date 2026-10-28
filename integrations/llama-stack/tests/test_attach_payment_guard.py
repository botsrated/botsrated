"""attach_payment_guard registers PaymentGuard. The free preflight helper does not."""

from __future__ import annotations

import inspect
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx
import pytest
from support import (
    DEAD,
    FOUND,
    TOKEN,
    RecordingClientSync,
    ctx,
    ensure_remote_policy_guard,
    policy_calls,
    policy_view,
    supports_remote_policy,
)

from llama_stack_botsrated import attach_payment_guard, botsrated_preflight
from llama_stack_botsrated.guard import _remote_policy_kwargs

_FORBIDDEN = (
    "import llama_stack",
    "from llama_stack ",
    "from llama_stack.",
    "before_tool",
    "create_payment_payload",
    "sign_typed_data",
    "private_key",
    "eth_send",
    "AbortResult",
    "/v1/policy",
    "FEATURE_GUARD_POLICY",
    "StateGraph",
    "LlmAgent",
)


def test_package_is_a_payment_client_wrap_only():
    import llama_stack_botsrated as pkg

    assert pkg.__all__ == ["attach_payment_guard", "botsrated_preflight"]
    assert not any(
        hasattr(pkg, name)
        for name in (
            "before_tool",
            "botsrated_before_tool_callback",
            "register_botsrated_pre_tool_hook",
            "LlamaStack",
            "StackServer",
            "Distribution",
        )
    )
    sig = inspect.signature(attach_payment_guard)
    assert list(sig.parameters) == ["x402_client", "preset", "fail_mode", "token"]
    for name in ("preset", "fail_mode", "token"):
        assert sig.parameters[name].kind is inspect.Parameter.KEYWORD_ONLY
        assert sig.parameters[name].default is None
    root = Path(inspect.getfile(attach_payment_guard)).parent
    assert sorted(path.name for path in root.glob("*.py")) == ["__init__.py", "guard.py"]
    for path in root.glob("*.py"):
        text = path.read_text()
        for needle in _FORBIDDEN:
            assert needle not in text, needle


def test_default_install_section_is_at_most_15_lines():
    readme = (Path(__file__).resolve().parents[1] / "README.md").read_text()
    start = readme.index("## Default install")
    rest = readme[start:]
    nxt = rest.find("\n## ", 1)
    section = rest if nxt == -1 else rest[:nxt]
    lines = section.strip("\n").splitlines()
    assert len(lines) <= 15
    assert "deferred" in section.lower()
    assert "before-tool" in section.lower()


def test_preflight_helper_does_not_attach_a_guard(api):
    client = RecordingClientSync()
    out = json.loads(botsrated_preflight(FOUND["latest_probe"]["url"]))
    assert client.calls == []
    assert out["covered"] is True
    assert out["last_probe"]["receipt_url"].startswith("https://botsrated.com/receipt/")
    sent = " ".join(str(call.request.url) for call in api.calls)
    assert sent.startswith("https://botsrated.com/v1/preflight")
    assert "/v1/check" not in sent and "/v1/policy" not in sent
    assert "payTo" not in sent and DEAD not in sent
    source = inspect.getsource(botsrated_preflight)
    assert "attach_payment_guard" not in source
    assert "on_before_payment_creation" not in source
    assert ".install(" not in source
    assert "PaymentGuard" not in source


@pytest.mark.parametrize("preset", ["carefulBuyer", "strict"])
def test_attach_blocks_unobserved_payto_only_for_blocking_presets(api, preset: str):
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset=preset, fail_mode="open")
    assert client.calls == ["before", "after", "response", "extension"]
    assert "failure" not in client.calls and "sign" not in client.calls
    assert guard.fail_open is True
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
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
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
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
        url = FOUND["latest_probe"]["url"]
        pay_to = FOUND["latest_probe"]["live_payTo"]
        with guard.request(url):
            decision = guard.decide(ctx(pay_to))
            stopped = client.hooks["before"](ctx(pay_to))
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
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        guard.decide(ctx(FOUND["latest_probe"]["live_payTo"]))
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
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(ctx(FOUND["latest_probe"]["live_payTo"]))
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


def test_env_token_is_used_when_argument_is_omitted(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BOTSRATED_TOKEN", "env-token")

    class WithSnake:
        def __init__(self, remote_policy: Mapping[str, str] | None = None, **kwargs: Any) -> None:
            self.remote_policy = remote_policy
            self.kwargs = kwargs

        def install(self, client: Any) -> Any:
            self.client = client
            return self

    import botsrated.payment_guard as payment_guard

    if supports_remote_policy(payment_guard.PaymentGuard):
        guard = attach_payment_guard(RecordingClientSync(), preset="warn")
        assert policy_view(guard) == ("env-token", "open")
        assert not isinstance(guard.remote_policy, str)
        return

    monkeypatch.setattr(payment_guard, "PaymentGuard", WithSnake)
    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    assert guard.remote_policy == {"token": "env-token", "fail_mode": "open"}


def test_explicit_token_wins_over_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BOTSRATED_TOKEN", "env-token")

    class WithSnake:
        def __init__(self, remote_policy: Mapping[str, str] | None = None, **kwargs: Any) -> None:
            self.remote_policy = remote_policy
            self.kwargs = kwargs

        def install(self, client: Any) -> Any:
            self.client = client
            return self

    import botsrated.payment_guard as payment_guard

    if supports_remote_policy(payment_guard.PaymentGuard):
        guard = attach_payment_guard(RecordingClientSync(), token="explicit-token")
        assert policy_view(guard)[0] == "explicit-token"
        return
    monkeypatch.setattr(payment_guard, "PaymentGuard", WithSnake)
    guard = attach_payment_guard(RecordingClientSync(), token="explicit-token", fail_mode="closed")
    assert guard.remote_policy == {"token": "explicit-token", "fail_mode": "closed"}


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
    url = FOUND["latest_probe"]["url"]
    observed = FOUND["latest_probe"]["live_payTo"]
    with guard.request(url):
        blocked = guard.decide(ctx(observed))
        stopped = client.hooks["before"](ctx(observed))
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
    with strict.request(url):
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
    url = FOUND["latest_probe"]["url"]
    observed = FOUND["latest_probe"]["live_payTo"]
    with guard.request(url):
        decision = guard.decide(ctx(observed))
        stopped = client.hooks["before"](ctx(observed))
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
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(ctx(FOUND["latest_probe"]["live_payTo"]))
        proceeded = client.hooks["before"](ctx(FOUND["latest_probe"]["live_payTo"]))
    assert decision.action == "allow"
    assert any(reason.code == "remote_policy_unavailable" and reason.effect == "info" for reason in decision.reasons)
    assert not any(reason.effect == "block" for reason in decision.reasons)
    assert getattr(decision, "remote_decision", None) is None
    assert proceeded is None
    assert "sign" not in client.calls
