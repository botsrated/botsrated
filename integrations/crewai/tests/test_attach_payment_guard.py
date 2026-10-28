"""attach_payment_guard registers PaymentGuard. The free preflight helper does not."""

from __future__ import annotations

import copy
import inspect
import json
import sys
import types
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx
import pytest

from crewai_botsrated import attach_payment_guard, botsrated_preflight, register_botsrated_pre_tool_hook
from crewai_botsrated.guard import _remote_policy_kwargs

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


def test_package_does_not_ship_a_crew_runtime():
    import crewai_botsrated as pkg

    assert "attach_payment_guard" in pkg.__all__
    assert "register_botsrated_pre_tool_hook" in pkg.__all__
    assert "botsrated_preflight" in pkg.__all__
    assert not any(hasattr(pkg, name) for name in ("Crew", "Process", "Flow", "Agent", "kickoff"))
    root = Path(inspect.getfile(attach_payment_guard)).parent
    for path in root.glob("*.py"):
        text = path.read_text()
        assert "kickoff" not in text
        assert "class Crew" not in text
        assert "class Process" not in text
        assert "class Flow" not in text
        assert "FEATURE_GUARD_POLICY" not in text
        for line in text.splitlines():
            stripped = line.lstrip()
            if stripped.startswith(("import crewai.", "import crewai ", "from crewai.", "from crewai ")):
                assert line[:1] in (" ", "\t")


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


class _HookAborted(Exception):
    def __init__(self, reason: str = "", source: Any = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.source = source


class _ToolCall:
    """Stand-in for CrewAI's tool-call context. ``run`` is the tool. The hook must not call it."""

    def __init__(self, name: str, tool_input: dict[str, Any]) -> None:
        self.tool_name = name
        self.tool_input = tool_input
        self.ran = False

    def run(self) -> None:
        self.ran = True


def _install_crewai_hooks(monkeypatch: pytest.MonkeyPatch, *, modern: bool) -> dict[str, Any]:
    """Put a crewai.hooks stand-in on sys.modules. No crew is constructed and nothing is kicked off."""
    recorded: dict[str, Any] = {"calls": []}
    hooks = types.ModuleType("crewai.hooks")
    crewai = types.ModuleType("crewai")
    crewai.__path__ = []  # type: ignore[attr-defined]
    crewai.hooks = hooks  # type: ignore[attr-defined]
    if modern:

        class InterceptionPoint:
            PRE_TOOL_CALL = "pre_tool_call"

        def on(point: Any, *, agents: Any = None, tools: Any = None) -> Any:
            def deco(fn: Any) -> Any:
                recorded["calls"].append(("on", point, tools, fn))
                return fn

            return deco

        hooks.InterceptionPoint = InterceptionPoint  # type: ignore[attr-defined]
        hooks.HookAborted = _HookAborted  # type: ignore[attr-defined]
        hooks.on = on  # type: ignore[attr-defined]
        recorded["point"] = InterceptionPoint.PRE_TOOL_CALL
    else:

        def before_tool_call(fn: Any = None, *, tools: Any = None, agents: Any = None) -> Any:
            def deco(func: Any) -> Any:
                recorded["calls"].append(("legacy", tools, func))
                return func

            if fn is not None:
                return deco(fn)
            return deco

        hooks.before_tool_call = before_tool_call  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "crewai", crewai)
    monkeypatch.setitem(sys.modules, "crewai.hooks", hooks)
    return recorded


def test_default_install_section_is_at_most_15_lines():
    readme = (Path(__file__).resolve().parents[1] / "README.md").read_text()
    start = readme.index("## Default install")
    rest = readme[start:]
    nxt = rest.find("\n## ", 1)
    section = rest if nxt < 0 else rest[:nxt]
    assert len(section.strip("\n").splitlines()) <= 15


def test_preflight_does_not_register_a_hook(api, monkeypatch: pytest.MonkeyPatch):
    def boom() -> Any:
        raise AssertionError("preflight tried to register a hook")

    monkeypatch.setattr("crewai_botsrated.hooks._load_pre_tool_api", boom)
    out = json.loads(botsrated_preflight(FOUND["latest_probe"]["url"]))
    assert out["covered"] is True
    assert "crewai" not in sys.modules


def test_named_paid_tool_block_raises_hook_aborted_and_does_not_run_the_tool(api, monkeypatch: pytest.MonkeyPatch):
    recorded = _install_crewai_hooks(monkeypatch, modern=True)
    guard = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer")
    seen: list[Any] = []
    original = guard.decide

    def spy(ctx: Any) -> Any:
        seen.append(ctx)
        return original(ctx)

    guard.decide = spy  # type: ignore[method-assign]
    hook = register_botsrated_pre_tool_hook(guard, paid_tools={"pay_seller"})
    assert recorded["calls"] and recorded["calls"][0][0] == "on"
    assert recorded["calls"][0][1] == recorded["point"]
    assert recorded["calls"][0][2] is None
    assert recorded["calls"][0][3] is hook
    tool_input = {"payment_context": _ctx(DEAD), "note": "keep"}
    call = _ToolCall("pay_seller", tool_input)
    before = copy.deepcopy(tool_input)
    with pytest.raises(_HookAborted) as exc:
        hook(call)
    assert exc.value.source == "botsrated"
    assert "Payment stopped by your payment policy" in exc.value.reason
    assert call.ran is False
    assert call.tool_input is tool_input
    assert tool_input == before
    assert seen and seen[0]["selected_requirements"]["payTo"] == DEAD


def test_mapping_keys_are_the_paid_tool_names_and_other_tools_are_left_alone(api, monkeypatch: pytest.MonkeyPatch):
    _install_crewai_hooks(monkeypatch, modern=True)
    guard = attach_payment_guard(RecordingClientSync(), preset="strict")

    def boom(_ctx: Any) -> Any:
        raise AssertionError("guard was asked about a tool that is not named")

    guard.decide = boom  # type: ignore[method-assign]
    hook = register_botsrated_pre_tool_hook(guard, paid_tools={"pay_seller": "ignored"})
    other = _ToolCall("search", {"payment_context": _ctx(DEAD)})
    assert hook(other) is None
    assert other.ran is False
    with pytest.raises(_HookAborted) as exc:
        hook(_ToolCall("pay_seller", {"x402": _ctx(DEAD)}))
    assert exc.value.source == "botsrated"


def test_omitted_preset_hook_does_not_block_an_unobserved_payto(api, monkeypatch: pytest.MonkeyPatch):
    _install_crewai_hooks(monkeypatch, modern=True)
    guard = attach_payment_guard(RecordingClientSync())
    hook = register_botsrated_pre_tool_hook(guard, paid_tools={"pay_seller"})
    call = _ToolCall("pay_seller", {"payment": _ctx(DEAD)})
    before = copy.deepcopy(call.tool_input)
    assert hook(call) is None
    assert call.ran is False
    assert call.tool_input == before


def test_legacy_before_tool_call_returns_false(api, monkeypatch: pytest.MonkeyPatch):
    recorded = _install_crewai_hooks(monkeypatch, modern=False)
    guard = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer")
    hook = register_botsrated_pre_tool_hook(guard, "pay_seller")
    assert recorded["calls"] and recorded["calls"][0][0] == "legacy"
    assert recorded["calls"][0][2] is hook
    call = _ToolCall("pay_seller", {"payment_context": _ctx(DEAD)})
    assert hook(call) is False
    assert call.ran is False
    allowed = _ToolCall("search", {"payment_context": _ctx(DEAD)})
    assert hook(allowed) is None
    assert allowed.ran is False


def test_register_without_either_hook_api_raises(monkeypatch: pytest.MonkeyPatch):
    hooks = types.ModuleType("crewai.hooks")
    crewai = types.ModuleType("crewai")
    crewai.__path__ = []  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "crewai", crewai)
    monkeypatch.setitem(sys.modules, "crewai.hooks", hooks)
    with pytest.raises(ImportError, match="before_tool_call"):
        register_botsrated_pre_tool_hook(attach_payment_guard(RecordingClientSync(), preset="warn"), {"pay_seller"})


def test_missing_payment_context_blocks_the_named_tool_without_calling_the_guard(monkeypatch: pytest.MonkeyPatch):
    _install_crewai_hooks(monkeypatch, modern=True)
    guard = attach_payment_guard(RecordingClientSync(), preset="warn")

    def boom(_ctx: Any) -> Any:
        raise AssertionError("guard was asked")

    guard.decide = boom  # type: ignore[method-assign]
    hook = register_botsrated_pre_tool_hook(guard, {"pay_seller"})
    call = _ToolCall("pay_seller", {"query": "hello"})
    before = copy.deepcopy(call.tool_input)
    with pytest.raises(_HookAborted) as exc:
        hook(call)
    assert "could not be read" in exc.value.reason
    assert exc.value.source == "botsrated"
    assert call.ran is False
    assert call.tool_input == before


def test_hook_blocks_when_the_guard_raises(monkeypatch: pytest.MonkeyPatch):
    from contextlib import contextmanager

    _install_crewai_hooks(monkeypatch, modern=True)

    class Boom:
        def request(self, _url: str):
            @contextmanager
            def _cm():
                yield

            return _cm()

        def decide(self, _ctx: Any) -> Any:
            raise RuntimeError("boom")

    hook = register_botsrated_pre_tool_hook(Boom(), {"pay_seller"})
    call = _ToolCall("pay_seller", {"payment_context": _ctx(DEAD)})
    with pytest.raises(_HookAborted) as exc:
        hook(call)
    assert call.ran is False
    assert "could not evaluate" in exc.value.reason
    assert exc.value.source == "botsrated"


def test_hook_remote_block_stops_and_pass_does_not_clear_a_local_block(api, monkeypatch: pytest.MonkeyPatch):
    _install_crewai_hooks(monkeypatch, modern=True)
    _ensure_remote_policy_guard(monkeypatch)
    api.post("/v1/policy/check").respond(200, json={"decision": "block"})
    guard = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="open")
    hook = register_botsrated_pre_tool_hook(guard, paid_tools={"pay_seller"})
    observed = FOUND["latest_probe"]["live_payTo"]
    call = _ToolCall("pay_seller", {"x402": _ctx(observed), "keep": "yes"})
    before = copy.deepcopy(call.tool_input)
    with pytest.raises(_HookAborted) as exc:
        hook(call)
    assert call.ran is False
    assert call.tool_input == before
    assert exc.value.source == "botsrated"
    assert _policy_calls(api)

    api.post("/v1/policy/check").respond(200, json={"decision": "pass"})
    strict = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer", token=TOKEN, fail_mode="open")
    strict_hook = register_botsrated_pre_tool_hook(strict, paid_tools=["pay_seller"])
    quote = _ctx(DEAD)
    blocked = _ToolCall(
        "pay_seller",
        {"payment_required": quote["payment_required"], "selected_requirements": quote["selected_requirements"]},
    )
    with pytest.raises(_HookAborted) as still:
        strict_hook(blocked)
    assert blocked.ran is False
    assert still.value.source == "botsrated"
    with strict.request(FOUND["latest_probe"]["url"]):
        decision = strict.decide(_ctx(DEAD))
    assert decision.action == "block"
    assert any(reason.code == "payto_not_observed" and reason.effect == "block" for reason in decision.reasons)


def test_hook_closed_null_decision_blocks_and_open_does_not_invent_a_pass(api, monkeypatch: pytest.MonkeyPatch):
    _install_crewai_hooks(monkeypatch, modern=True)
    _ensure_remote_policy_guard(monkeypatch)
    api.post("/v1/policy/check").respond(200, json={"decision": None})
    observed = FOUND["latest_probe"]["live_payTo"]
    closed = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="closed")
    closed_hook = register_botsrated_pre_tool_hook(closed, {"pay_seller"})
    with pytest.raises(_HookAborted) as exc:
        closed_hook(_ToolCall("pay_seller", {"payment_context": _ctx(observed)}))
    assert exc.value.source == "botsrated"
    opened = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="open")
    opened_hook = register_botsrated_pre_tool_hook(opened, {"pay_seller"})
    call = _ToolCall("pay_seller", {"payment_context": _ctx(observed)})
    assert opened_hook(call) is None
    assert call.ran is False


def test_empty_paid_tools_is_rejected(monkeypatch: pytest.MonkeyPatch):
    _install_crewai_hooks(monkeypatch, modern=True)
    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    with pytest.raises(ValueError):
        register_botsrated_pre_tool_hook(guard, set())
    with pytest.raises(ValueError):
        register_botsrated_pre_tool_hook(guard, {"": True})
    with pytest.raises(ValueError):
        register_botsrated_pre_tool_hook(guard, "")


def test_custom_context_reader_is_used_and_the_tool_input_is_not_rewritten(api, monkeypatch: pytest.MonkeyPatch):
    _install_crewai_hooks(monkeypatch, modern=True)
    guard = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer")
    seen: list[str] = []

    def read(ctx: _ToolCall) -> dict[str, Any]:
        seen.append(ctx.tool_name)
        return _ctx(DEAD)

    hook = register_botsrated_pre_tool_hook(guard, {"pay_seller"}, context=read)
    call = _ToolCall("pay_seller", {"query": "untouched"})
    before = copy.deepcopy(call.tool_input)
    with pytest.raises(_HookAborted):
        hook(call)
    assert seen == ["pay_seller"]
    assert call.tool_input == before
    assert call.ran is False


def test_attach_and_hook_sources_do_not_sign_or_call_policy():
    root = Path(inspect.getfile(attach_payment_guard)).parent
    for name in ("guard.py", "hooks.py", "__init__.py"):
        text = (root / name).read_text()
        for needle in (
            "create_payment_payload",
            "sign_typed_data",
            "private_key",
            "eth_send",
            "AbortResult",
            "/v1/policy",
            "FEATURE_GUARD_POLICY",
            "kickoff",
            "class Crew",
            "class Process",
            "class Flow",
        ):
            assert needle not in text
    hooks = (root / "hooks.py").read_text()
    assert "PRE_TOOL_CALL" in hooks
    assert "before_tool_call" in hooks
    assert hooks.index("PRE_TOOL_CALL") < hooks.index("before_tool_call")
    assert 'source="botsrated"' in hooks
    assert ".install(" not in hooks
    assert "attach_payment_guard" not in hooks
