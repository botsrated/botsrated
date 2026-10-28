"""The existing middleware judges named payment tools with the shared PaymentGuard.

A scripted chat client stands in for the model. Nothing is paid and no provider is called.
"""

from __future__ import annotations

import inspect
from contextlib import contextmanager
from typing import Any

import httpx
import pytest
from agent_framework import Agent
from conftest import ScriptedModel, results
from support import (
    AMOUNT,
    DEAD,
    OBSERVED,
    SELLER,
    TOKEN,
    RecordingClientSync,
    ensure_remote_policy_guard,
    policy_calls,
    policy_view,
)

from agent_framework_botsrated import (
    BotsRatedPaymentBlocked,
    BotsRatedPaymentMiddleware,
    attach_payment_guard,
)
from agent_framework_botsrated.guard import build_payment_guard

paid: list[str] = []


def pay_x402(url: str, pay_to: str, amount: str, network: str = "eip155:8453") -> str:
    """Pay an x402 seller (test stub)."""
    paid.append(pay_to)
    return f"PAID {pay_to}"


def get_weather(city: str) -> str:
    """Get the weather."""
    return f"Sunny in {city}"


@pytest.fixture(autouse=True)
def _reset() -> None:
    paid.clear()


def _agent(model: ScriptedModel, middleware: BotsRatedPaymentMiddleware, *tools: Any) -> Agent:
    return Agent(client=model, tools=list(tools or (pay_x402,)), middleware=[middleware])


async def test_shared_guard_blocks_unobserved_payto_and_leaves_other_tools_alone(api):
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="carefulBuyer", fail_mode="open")
    hooks = list(client.calls)
    seen: list[Any] = []
    original = guard.decide

    def spy(payment: Any) -> Any:
        seen.append(payment)
        return original(payment)

    guard.decide = spy  # type: ignore[method-assign]
    model = ScriptedModel(
        [
            ("bad", "pay_x402", {"url": SELLER, "pay_to": DEAD, "amount": AMOUNT}),
            ("w", "get_weather", {"city": "Paris"}),
        ]
    )
    middleware = BotsRatedPaymentMiddleware(["pay_x402"], guard=guard)
    assert middleware.guard is guard
    out = results(await _agent(model, middleware, pay_x402, get_weather).run("pay"))
    assert paid == []
    assert "was not executed" in str(out["bad"])
    assert "Payment stopped by your payment policy" in str(out["bad"])
    assert out["w"] == "Sunny in Paris"
    assert len(seen) == 1
    assert seen[0]["selected_requirements"]["payTo"] == DEAD
    assert seen[0]["payment_required"]["resource"]["url"] == SELLER
    assert client.calls == hooks
    assert "sign" not in client.calls
    assert policy_calls(api) == []


async def test_observed_payto_runs_when_the_request_url_is_known(api):
    guard = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer")
    decisions: list[Any] = []
    guard.on_decision = decisions.append
    model = ScriptedModel([("good", "pay_x402", {"url": SELLER, "pay_to": OBSERVED, "amount": AMOUNT})])
    await _agent(model, BotsRatedPaymentMiddleware(["pay_x402"], guard=guard)).run("pay")
    assert paid == [OBSERVED]
    assert decisions[0].action == "allow"
    assert not any(reason.code == "paid_url_unknown" and reason.effect == "block" for reason in decisions[0].reasons)


async def test_fail_mode_without_preset_keeps_the_unobserved_payto_block(api):
    middleware = BotsRatedPaymentMiddleware(["pay_x402"], fail_mode="open")
    assert middleware.guard.policy.pay_to_mismatch == "block"
    assert middleware.guard.fail_open is True
    decisions: list[Any] = []
    middleware.guard.on_decision = decisions.append
    model = ScriptedModel([("bad", "pay_x402", {"url": SELLER, "pay_to": DEAD, "amount": AMOUNT})])
    out = results(await _agent(model, middleware).run("pay"))
    assert paid == []
    assert "was not executed" in str(out["bad"])
    assert decisions[0].action == "block"
    assert any(reason.code == "payto_not_observed" and reason.effect == "block" for reason in decisions[0].reasons)
    assert policy_calls(api) == []


async def test_token_without_preset_keeps_the_unobserved_payto_block(api, monkeypatch: pytest.MonkeyPatch):
    ensure_remote_policy_guard(monkeypatch)
    api.post("/v1/policy/check").respond(200, json={"decision": "pass"})
    middleware = BotsRatedPaymentMiddleware(["pay_x402"], token=TOKEN)
    assert middleware.guard.policy.pay_to_mismatch == "block"
    model = ScriptedModel([("bad", "pay_x402", {"url": SELLER, "pay_to": DEAD, "amount": AMOUNT})])
    out = results(await _agent(model, middleware).run("pay"))
    assert paid == []
    assert "was not executed" in str(out["bad"])
    assert policy_calls(api)


@pytest.mark.parametrize("preset", ["carefulBuyer", "strict"])
async def test_preset_on_middleware_blocks_only_when_selected(api, preset: str):
    from botsrated.payment_guard import POLICIES

    middleware = BotsRatedPaymentMiddleware(["pay_x402"], preset=preset)
    if preset == "strict":
        assert middleware.guard.policy is POLICIES["strict"]
    model = ScriptedModel([("bad", "pay_x402", {"url": SELLER, "pay_to": DEAD, "amount": AMOUNT})])
    out = results(await _agent(model, middleware).run("pay"))
    assert paid == []
    assert "was not executed" in str(out["bad"])


async def test_on_block_raise_ends_the_run(api):
    guard = attach_payment_guard(RecordingClientSync(), preset="strict")
    model = ScriptedModel([("bad", "pay_x402", {"url": SELLER, "pay_to": DEAD, "amount": AMOUNT})])
    middleware = BotsRatedPaymentMiddleware(["pay_x402"], guard=guard, on_block="raise")
    with pytest.raises(BotsRatedPaymentBlocked) as info:
        await _agent(model, middleware).run("pay")
    assert info.value.decision.action == "block"
    assert any(reason.code == "payto_not_observed" for reason in info.value.decision.reasons)
    assert paid == []


async def test_unreadable_quote_blocks_without_calling_the_guard(api):
    def pay_somehow(target: str) -> str:
        """A payment tool whose arguments carry no quote."""
        paid.append(target)
        return "PAID"

    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    seen: list[Any] = []
    guard.decide = lambda _payment: seen.append(_payment)  # type: ignore[method-assign]
    model = ScriptedModel([("x", "pay_somehow", {"target": SELLER})])
    middleware = BotsRatedPaymentMiddleware(["pay_somehow"], guard=guard)
    out = results(await _agent(model, middleware, pay_somehow).run("pay"))
    assert paid == []
    assert seen == []
    assert api.calls == []
    assert "quote_unreadable" in str(out["x"])


async def test_guard_error_does_not_run_the_tool():
    class Boom:
        def request(self, _url: str):
            @contextmanager
            def _cm():
                yield

            return _cm()

        def decide(self, _payment: Any) -> Any:
            raise RuntimeError("boom")

    def pay_x402_boom(url: str, pay_to: str, amount: str) -> str:
        """Pay."""
        paid.append(pay_to)
        return "PAID"

    model = ScriptedModel([("bad", "pay_x402_boom", {"url": SELLER, "pay_to": DEAD, "amount": AMOUNT})])
    middleware = BotsRatedPaymentMiddleware(["pay_x402_boom"], guard=Boom())
    out = results(await _agent(model, middleware, pay_x402_boom).run("pay"))
    assert paid == []
    assert "hook_error" in str(out["x"] if "x" in out else out["bad"])


def test_preset_kwargs_match_attach_and_do_not_register_hooks():
    client = RecordingClientSync()
    attached = attach_payment_guard(client, preset="carefulBuyer", fail_mode="closed", token=TOKEN)
    built = BotsRatedPaymentMiddleware(
        ["pay_x402"], preset="carefulBuyer", fail_mode="closed", token=TOKEN
    ).guard
    assert built.policy == attached.policy
    assert built.fail_open is attached.fail_open is False
    assert policy_view(built) == policy_view(attached)
    assert client.calls == ["before", "after", "response", "extension"]
    lone = RecordingClientSync()
    BotsRatedPaymentMiddleware(["pay_x402"], preset="warn")
    assert lone.calls == []
    assert ".install(" not in inspect.getsource(build_payment_guard)


def test_guard_and_preset_together_are_rejected():
    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    with pytest.raises(ValueError):
        BotsRatedPaymentMiddleware(["pay_x402"], guard=guard, preset="carefulBuyer")


async def test_without_token_middleware_makes_no_remote_http(api):
    middleware = BotsRatedPaymentMiddleware(["pay_x402"], preset="warn")
    assert policy_view(middleware.guard) is None
    model = ScriptedModel([("good", "pay_x402", {"url": SELLER, "pay_to": OBSERVED, "amount": AMOUNT})])
    await _agent(model, middleware).run("pay")
    assert paid == [OBSERVED]
    for call in api.calls:
        assert "/v1/policy" not in str(call.request.url)


async def test_token_without_parse_remote_policy_raises(api, monkeypatch: pytest.MonkeyPatch):
    import botsrated.payment_guard as payment_guard

    monkeypatch.delattr(payment_guard, "parse_remote_policy")
    api.post("/v1/policy/check").respond(200, json={"decision": "block"})
    with pytest.raises(TypeError, match="parse_remote_policy"):
        BotsRatedPaymentMiddleware(["pay_x402"], preset="warn", token=TOKEN)
    assert policy_calls(api) == []
    assert paid == []


async def test_remote_block_stops_and_remote_pass_does_not_clear_a_local_block(api, monkeypatch: pytest.MonkeyPatch):
    ensure_remote_policy_guard(monkeypatch)
    responses = [{"decision": "block"}, {"decision": "pass"}]

    def _reply(_request: Any) -> httpx.Response:
        return httpx.Response(200, json=responses.pop(0))

    api.post("/v1/policy/check").mock(side_effect=_reply)
    guard = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="open")
    model = ScriptedModel([("pay", "pay_x402", {"url": SELLER, "pay_to": OBSERVED, "amount": AMOUNT})])
    out = results(await _agent(model, BotsRatedPaymentMiddleware(["pay_x402"], guard=guard)).run("pay"))
    assert paid == []
    assert "was not executed" in str(out["pay"])
    assert policy_calls(api)

    strict = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer", token=TOKEN, fail_mode="open")
    again = ScriptedModel([("bad", "pay_x402", {"url": SELLER, "pay_to": DEAD, "amount": AMOUNT})])
    blocked = results(await _agent(again, BotsRatedPaymentMiddleware(["pay_x402"], guard=strict)).run("pay"))
    assert responses == []
    assert paid == []
    assert "was not executed" in str(blocked["bad"])


@pytest.mark.parametrize(
    ("status", "body", "transport"),
    [
        (200, {"decision": None}, False),
        (503, {"decision": None}, False),
        (None, {}, True),
    ],
)
async def test_fail_mode_closed_null_decision_does_not_run_the_tool(
    api, monkeypatch: pytest.MonkeyPatch, status: int | None, body: dict[str, Any], transport: bool
):
    ensure_remote_policy_guard(monkeypatch)
    route = api.post("/v1/policy/check")
    if transport:
        route.mock(side_effect=httpx.ConnectError("unreachable"))
    else:
        route.respond(status, json=body)
    guard = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="closed")
    decisions: list[Any] = []
    guard.on_decision = decisions.append
    model = ScriptedModel([("pay", "pay_x402", {"url": SELLER, "pay_to": OBSERVED, "amount": AMOUNT})])
    out = results(await _agent(model, BotsRatedPaymentMiddleware(["pay_x402"], guard=guard)).run("pay"))
    assert route.called
    assert paid == []
    assert "was not executed" in str(out["pay"])
    assert decisions[0].action == "block"
    assert decisions[0].remote_decision is None


async def test_fail_mode_open_null_decision_lets_the_tool_run(api, monkeypatch: pytest.MonkeyPatch):
    ensure_remote_policy_guard(monkeypatch)
    api.post("/v1/policy/check").respond(200, json={"decision": None})
    guard = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="open")
    decisions: list[Any] = []
    guard.on_decision = decisions.append
    model = ScriptedModel([("pay", "pay_x402", {"url": SELLER, "pay_to": OBSERVED, "amount": AMOUNT})])
    out = results(await _agent(model, BotsRatedPaymentMiddleware(["pay_x402"], guard=guard)).run("pay"))
    assert out["pay"] == f"PAID {OBSERVED}"
    assert paid == [OBSERVED]
    assert decisions[0].action == "allow"
    assert decisions[0].remote_decision is None
    assert any(
        reason.code == "remote_policy_unavailable" and reason.effect == "info" for reason in decisions[0].reasons
    )
