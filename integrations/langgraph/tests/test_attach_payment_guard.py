"""attach_payment_guard registers PaymentGuard. The free preflight helper does not."""

from __future__ import annotations

import asyncio
import copy
import inspect
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx
import pytest

from langgraph_botsrated import (
    BOTSRATED_PAYMENT_REASON,
    attach_payment_guard,
    botsrated_payment_middleware,
    botsrated_preflight,
)
from langgraph_botsrated.guard import _remote_policy_kwargs

FX = Path(__file__).resolve().parents[2] / "fixtures"
FOUND = json.loads((FX / "preflight-found.json").read_text())
DEAD = "0x000000000000000000000000000000000000dEaD"
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
TOKEN = "policy-token-example"


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
    return {
        "payment_required": {"x402Version": 2, "resource": {"url": url}, "accepts": [req]},
        "selected_requirements": req,
    }


def _supports_remote_policy(guard_cls: type | None = None) -> bool:
    """True when this botsrated exports parse_remote_policy. The class is not inspected."""
    del guard_cls
    try:
        from botsrated.payment_guard import parse_remote_policy
    except ImportError:
        return False
    return callable(parse_remote_policy)


def _policy_view(guard: Any) -> tuple[str, str] | None:
    policy = getattr(guard, "remote_policy", None)
    if policy is None:
        return None
    if isinstance(policy, str):
        raise AssertionError("remote_policy must be a mapping, not a bare token string")
    if isinstance(policy, Mapping):
        return str(policy["token"]), str(policy["fail_mode"])
    return str(policy.token), str(policy.fail_mode)


def _quote(ctx: Any) -> dict[str, str]:
    req = ctx.get("selected_requirements") if isinstance(ctx, Mapping) else None
    if not isinstance(req, Mapping):
        return {}
    quote: dict[str, str] = {}
    for key in ("payTo", "amount", "asset", "network"):
        value = req.get(key)
        if isinstance(value, str) and value:
            quote[key] = value
    return quote


def _named_decision(body: Any) -> str | None:
    """pass, warn, or block. allow is pass. null and any other label are no decision."""
    if not isinstance(body, Mapping) or "decision" not in body:
        return None
    raw = body.get("decision")
    if not isinstance(raw, str):
        return None
    key = raw.strip().lower()
    if key == "block":
        return "block"
    if key == "warn":
        return "warn"
    if key in ("pass", "allow"):
        return "pass"
    return None


def _post_policy(token: str, host: str, ctx: Any) -> str | None:
    try:
        resp = httpx.post(
            "https://botsrated.com/v1/policy/check",
            json={"host": host, "quote": _quote(ctx)},
            headers={"accept": "application/json", "authorization": f"Bearer {token}"},
            timeout=3.0,
            follow_redirects=False,
        )
    except Exception:  # noqa: BLE001 - transport failure is no decision, not a pass
        return None
    if not 200 <= resp.status_code < 300:
        return None
    try:
        body = resp.json()
    except ValueError:
        body = {}
    return _named_decision(body)


def _merge_remote(local: Any, ctx: Any, policy: Any) -> Any:
    """Stand-in merge for PaymentGuard remote_policy (PR #15) when that keyword is absent."""
    if not policy or not getattr(local, "host", None):
        return local
    if isinstance(policy, str):
        raise TypeError("remote_policy must be a RemotePolicy or a mapping.")
    if isinstance(policy, Mapping):
        token = str(policy.get("token") or "")
        fail_mode = policy.get("fail_mode", policy.get("failMode")) or "open"
    else:
        token = policy.token
        fail_mode = policy.fail_mode
    host = local.host
    decision = _post_policy(token, host, ctx)
    from botsrated.payment_guard import GuardReason

    was_block = local.action == "block"
    if decision == "block":
        local.reasons.append(
            GuardReason("remote_policy", "block", f"your policy returned block for {host}.", "remotePolicy")
        )
    elif decision == "warn":
        local.reasons.append(
            GuardReason("remote_policy", "warn", f"your policy returned warn for {host}.", "remotePolicy")
        )
    elif decision == "pass":
        pass
    else:
        effect = "block" if fail_mode == "closed" else "info"
        local.reasons.append(
            GuardReason(
                "remote_policy_unavailable",
                effect,
                f"your policy check returned no decision; fail_mode is {fail_mode}.",
                "failMode",
            )
        )
    if any(reason.effect == "block" for reason in local.reasons):
        local.would_block = True
        if not local.dry_run:
            local.action = "block"
        if local.action == "block" and not was_block:
            stopping = next(reason for reason in local.reasons if reason.effect == "block")
            local.message = (
                "Payment stopped by your payment policy "
                f"(rule: {stopping.rule or stopping.code}). Fact: {stopping.fact}"
            )
    return local


def _ensure_remote_policy_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use the installed PaymentGuard when it accepts remote_policy. Otherwise stand in for PR #15."""
    import botsrated.payment_guard as payment_guard

    real = payment_guard.PaymentGuard
    if _supports_remote_policy(real):
        return

    class RemotePolicyGuard(real):  # type: ignore[misc]
        def __init__(self, *args: Any, remote_policy: Any = None, **kwargs: Any) -> None:
            if remote_policy is not None and not isinstance(remote_policy, Mapping):
                raise TypeError("remote_policy must be a RemotePolicy or a mapping.")
            super().__init__(*args, **kwargs)
            self.remote_policy = remote_policy

        def decide(self, ctx: Any) -> Any:
            return _merge_remote(super().decide(ctx), ctx, self.remote_policy)

        async def adecide(self, ctx: Any) -> Any:
            local = await super().adecide(ctx)
            return _merge_remote(local, ctx, self.remote_policy)

    monkeypatch.setattr(payment_guard, "PaymentGuard", RemotePolicyGuard)


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


def _policy_calls(mock: Any) -> list[Any]:
    return [call for call in mock.calls if "/v1/policy/check" in str(call.request.url)]


def test_package_does_not_ship_a_graph_runtime():
    import langgraph_botsrated as pkg

    assert "attach_payment_guard" in pkg.__all__
    assert "botsrated_payment_middleware" in pkg.__all__
    assert not any(hasattr(pkg, name) for name in ("StateGraph", "CompiledGraph", "InMemorySaver", "Agent", "Runner"))
    root = Path(inspect.getfile(attach_payment_guard)).parent
    for path in root.glob("*.py"):
        text = path.read_text()
        assert "import langgraph" not in text
        assert "StateGraph" not in text
        assert "FEATURE_GUARD_POLICY" not in text


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
    text = Path(inspect.getfile(botsrated_preflight)).read_text()
    assert "attach_payment_guard" not in text
    assert "on_before_payment_creation" not in text
    assert ".install(" not in text


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
        decision = guard.decide(_ctx(DEAD))
        out = client.hooks["before"](_ctx(DEAD))
    assert decision.action == "allow"
    assert any(reason.code == "payto_not_observed" and reason.effect == "warn" for reason in decision.reasons)
    assert out is None
    assert "sign" not in client.calls
    assert _policy_calls(api) == []


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
            decision = guard.decide(_ctx(pay_to))
            stopped = client.hooks["before"](_ctx(pay_to))
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
        guard.decide(_ctx(FOUND["latest_probe"]["live_payTo"]))
    assert api.calls
    for call in api.calls:
        target = str(call.request.url)
        assert target.startswith("https://botsrated.com/v1/preflight")
        assert "/v1/policy" not in target
    assert _policy_view(guard) is None


def test_token_is_a_mapping_only_when_parse_remote_policy_exists():
    """parse_remote_policy is the gate. A constructor signature is not consulted."""

    def normalizer(value: object) -> object:
        return value

    snake = _remote_policy_kwargs("abc", "closed", normalizer=normalizer)
    assert snake == {"remote_policy": {"token": "abc", "fail_mode": "closed"}}
    assert isinstance(snake["remote_policy"], dict)
    assert _remote_policy_kwargs("abc", None, normalizer=normalizer) == {
        "remote_policy": {"token": "abc", "fail_mode": "open"},
    }
    assert _remote_policy_kwargs(None, "closed", normalizer=normalizer) == {}
    assert _remote_policy_kwargs("", "closed", normalizer=normalizer) == {}
    with pytest.raises(TypeError, match="parse_remote_policy"):
        _remote_policy_kwargs("abc", "closed", normalizer=None)



def test_token_without_remote_policy_kwarg_does_not_call_or_raise(api):
    api.post("/v1/policy/check").respond(200, json={"decision": "pass"})
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", token=TOKEN, fail_mode="closed")
    assert not _supports_remote_policy(type(guard)) or _policy_view(guard) == (TOKEN, "closed")
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(_ctx(FOUND["latest_probe"]["live_payTo"]))
    sent = " ".join(str(call.request.url) + str(call.request.content) + str(call.request.headers) for call in api.calls)
    if not _supports_remote_policy(type(guard)):
        assert TOKEN not in sent
        assert TOKEN not in repr(guard.__dict__)
        assert _policy_calls(api) == []
        assert decision.action == "allow"
    else:
        assert _policy_view(guard) == (TOKEN, "closed")
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

    if _supports_remote_policy(payment_guard.PaymentGuard):
        guard = attach_payment_guard(RecordingClientSync(), preset="warn")
        assert _policy_view(guard) == ("env-token", "open")
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

    if _supports_remote_policy(payment_guard.PaymentGuard):
        guard = attach_payment_guard(RecordingClientSync(), token="explicit-token")
        assert _policy_view(guard)[0] == "explicit-token"
        return
    monkeypatch.setattr(payment_guard, "PaymentGuard", WithSnake)
    guard = attach_payment_guard(RecordingClientSync(), token="explicit-token", fail_mode="closed")
    assert guard.remote_policy == {"token": "explicit-token", "fail_mode": "closed"}


def test_mocked_remote_block_stops_and_pass_does_not_clear_local_block(api, monkeypatch: pytest.MonkeyPatch):
    pytest.importorskip("x402")
    _ensure_remote_policy_guard(monkeypatch)
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
    assert _policy_view(guard) == (TOKEN, "open")
    assert not isinstance(getattr(guard, "remote_policy", None), str)
    url = FOUND["latest_probe"]["url"]
    observed = FOUND["latest_probe"]["live_payTo"]
    with guard.request(url):
        blocked = guard.decide(_ctx(observed))
        stopped = client.hooks["before"](_ctx(observed))
    assert _policy_calls(api)
    policy_call = _policy_calls(api)[0]
    assert str(policy_call.request.url) == "https://botsrated.com/v1/policy/check"
    assert policy_call.request.headers["authorization"] == f"Bearer {TOKEN}"
    assert "payment-signature" not in {key.lower() for key in policy_call.request.headers}
    assert blocked.action == "block"
    assert any(reason.code == "remote_policy" and reason.effect == "block" for reason in blocked.reasons)
    assert stopped is not None and type(stopped).__name__ == "AbortResult"
    assert "sign" not in client.calls

    strict = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer", token=TOKEN, fail_mode="open")
    with strict.request(url):
        still = strict.decide(_ctx(DEAD))
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
    _ensure_remote_policy_guard(monkeypatch)
    route = api.post("/v1/policy/check")
    if transport:
        route.mock(side_effect=httpx.ConnectError("unreachable"))
    else:
        route.respond(status, json=body)
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", token=TOKEN, fail_mode="closed")
    assert guard.fail_open is False
    assert _policy_view(guard) == (TOKEN, "closed")
    url = FOUND["latest_probe"]["url"]
    observed = FOUND["latest_probe"]["live_payTo"]
    with guard.request(url):
        decision = guard.decide(_ctx(observed))
        stopped = client.hooks["before"](_ctx(observed))
    assert route.called
    assert decision.action == "block"
    assert any(reason.code == "remote_policy_unavailable" and reason.effect == "block" for reason in decision.reasons)
    assert getattr(decision, "remote_decision", None) is None
    assert stopped is not None and type(stopped).__name__ == "AbortResult"
    assert "sign" not in client.calls


def test_fail_mode_open_null_decision_is_info_and_not_a_pass(api, monkeypatch: pytest.MonkeyPatch):
    _ensure_remote_policy_guard(monkeypatch)
    api.post("/v1/policy/check").respond(200, json={"decision": None})
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="warn", token=TOKEN, fail_mode="open")
    url = FOUND["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(_ctx(FOUND["latest_probe"]["live_payTo"]))
        proceeded = client.hooks["before"](_ctx(FOUND["latest_probe"]["live_payTo"]))
    assert decision.action == "allow"
    assert any(reason.code == "remote_policy_unavailable" and reason.effect == "info" for reason in decision.reasons)
    assert not any(reason.effect == "block" for reason in decision.reasons)
    assert getattr(decision, "remote_decision", None) is None
    assert proceeded is None
    assert "sign" not in client.calls


def test_middleware_uses_the_same_guard_and_only_writes_the_reason_field(api):
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="carefulBuyer")
    seen: list[Any] = []
    original = guard.decide

    def spy(ctx: Any) -> Any:
        seen.append((guard, ctx))
        return original(ctx)

    guard.decide = spy  # type: ignore[method-assign]
    called: list[Any] = []

    def pay_node(state: dict[str, Any]) -> dict[str, bool]:
        called.append(state)
        state["paid"] = True
        return {"paid": True}

    state = {"payment_context": _ctx(DEAD), "counter": 1}
    before = copy.deepcopy(state)
    wrapped = botsrated_payment_middleware(guard, pay_node)
    result = wrapped(state)
    assert called == []
    assert state == before
    assert list(result) == [BOTSRATED_PAYMENT_REASON]
    assert "Payment stopped by your payment policy" in result[BOTSRATED_PAYMENT_REASON]
    assert seen and seen[0][0] is guard
    assert "paid" not in state

    allowed = {"paid": True, "messages": ["ok"]}

    def allow_node(state: dict[str, Any]) -> dict[str, Any]:
        return allowed

    warn = attach_payment_guard(RecordingClientSync(), preset="warn")
    passed = botsrated_payment_middleware(warn, allow_node)
    allow_state = {"payment": _ctx(DEAD), "counter": 1}
    allow_before = copy.deepcopy(allow_state)
    assert passed(allow_state) is allowed
    assert allow_state == allow_before
    assert BOTSRATED_PAYMENT_REASON not in allow_state


def test_middleware_remote_block_stops_the_node_without_mutating_state(api, monkeypatch: pytest.MonkeyPatch):
    _ensure_remote_policy_guard(monkeypatch)
    api.post("/v1/policy/check").respond(200, json={"decision": "block"})
    guard = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="open")
    called: list[Any] = []

    def pay_node(state: dict[str, Any]) -> dict[str, bool]:
        called.append(True)
        return {"paid": True}

    state = {"x402": _ctx(FOUND["latest_probe"]["live_payTo"]), "keep": "yes"}
    before = copy.deepcopy(state)
    result = botsrated_payment_middleware(guard, pay_node)(state)
    assert called == []
    assert state == before
    assert set(result) == {BOTSRATED_PAYMENT_REASON}
    assert _policy_calls(api)


def test_middleware_missing_context_does_not_run_the_node_or_call_the_network():
    def pay_node(state: dict[str, Any]) -> dict[str, bool]:
        raise AssertionError("node ran")

    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    state = {"messages": ["pay the seller"]}
    before = copy.deepcopy(state)
    result = botsrated_payment_middleware(guard, pay_node)(state)
    assert state == before
    assert list(result) == [BOTSRATED_PAYMENT_REASON]
    assert "could not be read" in result[BOTSRATED_PAYMENT_REASON]


def test_async_middleware_blocks_without_extra_state_fields(api):
    guard = attach_payment_guard(RecordingClientSync(), preset="strict")
    called: list[Any] = []

    async def pay_node(state: dict[str, Any]) -> dict[str, bool]:
        called.append(True)
        return {"paid": True}

    wrapped = botsrated_payment_middleware(guard, pay_node)
    assert inspect.iscoroutinefunction(wrapped)
    state = {"payment_context": _ctx(DEAD)}
    before = copy.deepcopy(state)
    result = asyncio.run(wrapped(state))
    assert called == []
    assert state == before
    assert list(result) == [BOTSRATED_PAYMENT_REASON]


def test_middleware_does_not_run_the_node_when_the_guard_raises():
    from contextlib import contextmanager

    class Boom:
        def request(self, _url: str):
            @contextmanager
            def _cm():
                yield

            return _cm()

        def decide(self, _ctx: Any) -> Any:
            raise RuntimeError("boom")

    def pay_node(state: dict[str, Any]) -> dict[str, bool]:
        raise AssertionError(state)

    state = {"payment_context": _ctx(DEAD)}
    before = copy.deepcopy(state)
    result = botsrated_payment_middleware(Boom(), pay_node)(state)
    assert state == before
    assert list(result) == [BOTSRATED_PAYMENT_REASON]
    assert "could not evaluate" in result[BOTSRATED_PAYMENT_REASON]


def test_attach_and_middleware_sources_do_not_sign_or_call_policy():
    root = Path(inspect.getfile(attach_payment_guard)).parent
    for name in ("guard.py", "middleware.py", "preflight.py", "__init__.py"):
        text = (root / name).read_text()
        for needle in (
            "create_payment_payload",
            "sign_typed_data",
            "private_key",
            "eth_send",
            "AbortResult",
            "/v1/policy",
            "FEATURE_GUARD_POLICY",
            "StateGraph",
        ):
            assert needle not in text
    middleware = (root / "middleware.py").read_text()
    assert ".install(" not in middleware
