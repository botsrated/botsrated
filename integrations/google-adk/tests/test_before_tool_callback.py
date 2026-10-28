"""before_tool_callback judges only named paid tools. A block skips the tool. No ADK runner."""

from __future__ import annotations

import copy
import inspect
from contextlib import contextmanager
from typing import Any

import httpx
import pytest
from support import (
    DEAD,
    FOUND,
    TOKEN,
    PaidTool,
    RecordingClientSync,
    ToolContext,
    ctx,
    ensure_remote_policy_guard,
    invoke_like_adk,
    policy_calls,
)

from google_adk_botsrated import BOTSRATED_PAYMENT_REASON, attach_payment_guard, botsrated_before_tool_callback


@pytest.fixture
def api():
    import respx

    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as mock:
        mock.get("/v1/preflight", params={"url": FOUND["host"]}).respond(200, json=FOUND)
        yield mock


def test_callback_parameters_match_adk_keyword_call():
    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    callback = botsrated_before_tool_callback(guard, ["pay_seller"])
    assert list(inspect.signature(callback).parameters) == ["tool", "args", "tool_context"]


def test_only_designated_paid_tools_are_judged(api):
    guard = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer")
    seen: list[Any] = []
    original = guard.decide

    def spy(payment: Any) -> Any:
        seen.append(payment)
        return original(payment)

    guard.decide = spy  # type: ignore[method-assign]
    callback = botsrated_before_tool_callback(guard, ["pay_seller"])
    weather = PaidTool("get_weather")
    args = {"city": "Paris", "payment_context": ctx(DEAD)}
    before = copy.deepcopy(args)
    tool_context = ToolContext()
    result = invoke_like_adk(callback, weather, args, tool_context)
    assert result == {"paid": True}
    assert weather.calls
    assert seen == []
    assert args == before
    assert api.calls == []


def test_block_does_not_run_the_tool_and_returns_only_the_reason_field(api):
    client = RecordingClientSync()
    guard = attach_payment_guard(client, preset="carefulBuyer")
    seen: list[Any] = []
    original = guard.decide

    def spy(payment: Any) -> Any:
        seen.append((guard, payment))
        return original(payment)

    guard.decide = spy  # type: ignore[method-assign]
    callback = botsrated_before_tool_callback(guard, {"pay_seller"})
    tool = PaidTool("pay_seller")
    args = {"payment_context": ctx(DEAD), "note": "opaque"}
    before_args = copy.deepcopy(args)
    tool_context = ToolContext({"untouched": True})
    before_state = copy.deepcopy(tool_context.state)
    result = invoke_like_adk(callback, tool, args, tool_context)
    assert tool.calls == []
    assert args == before_args
    assert tool_context.state == before_state
    assert list(result) == [BOTSRATED_PAYMENT_REASON]
    assert "Payment stopped by your payment policy" in result[BOTSRATED_PAYMENT_REASON]
    assert seen and seen[0][0] is guard
    direct = callback(tool, args, tool_context)
    assert list(direct) == [BOTSRATED_PAYMENT_REASON]
    assert tool.calls == []


def test_warn_preset_returns_none_so_the_tool_runs(api):
    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    callback = botsrated_before_tool_callback(guard, ["pay_seller"])
    tool = PaidTool("pay_seller")
    args = {"x402": ctx(DEAD)}
    before = copy.deepcopy(args)
    result = invoke_like_adk(callback, tool, args, ToolContext())
    assert result == {"paid": True}
    assert len(tool.calls) == 1
    assert args == before
    assert BOTSRATED_PAYMENT_REASON not in args


def test_payment_context_can_come_from_tool_state(api):
    guard = attach_payment_guard(RecordingClientSync(), preset="strict")
    callback = botsrated_before_tool_callback(guard, "pay_seller")
    tool = PaidTool("pay_seller")
    state = {"payment": ctx(DEAD), "keep": "yes"}
    before = copy.deepcopy(state)
    result = callback(tool=tool, args={"city": "Paris"}, tool_context=ToolContext(state))
    assert tool.calls == []
    assert state == before
    assert list(result) == [BOTSRATED_PAYMENT_REASON]


def test_missing_context_does_not_run_the_tool_or_call_the_network():
    def reader(tool: Any, args: Any, tool_context: Any) -> None:
        raise LookupError(tool.name)

    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    callback = botsrated_before_tool_callback(guard, ["pay_seller"], context=reader)
    tool = PaidTool("pay_seller")
    args = {"seller": "https://blockrun.ai"}
    before = copy.deepcopy(args)
    result = invoke_like_adk(callback, tool, args, ToolContext())
    assert tool.calls == []
    assert args == before
    assert list(result) == [BOTSRATED_PAYMENT_REASON]
    assert "could not be read" in result[BOTSRATED_PAYMENT_REASON]

    omitted = botsrated_before_tool_callback(guard, ["pay_seller"])
    again = omitted(tool=tool, args={"seller": "https://blockrun.ai"}, tool_context=ToolContext())
    assert list(again) == [BOTSRATED_PAYMENT_REASON]
    assert tool.calls == []


def test_guard_error_does_not_run_the_tool():
    class Boom:
        def request(self, _url: str):
            @contextmanager
            def _cm():
                yield

            return _cm()

        def decide(self, _payment: Any) -> Any:
            raise RuntimeError("boom")

    tool = PaidTool("pay_seller")
    callback = botsrated_before_tool_callback(Boom(), ["pay_seller"])
    result = invoke_like_adk(callback, tool, {"payment_context": ctx(DEAD)}, ToolContext())
    assert tool.calls == []
    assert list(result) == [BOTSRATED_PAYMENT_REASON]
    assert "could not evaluate" in result[BOTSRATED_PAYMENT_REASON]


def test_remote_block_skips_the_tool_and_remote_pass_does_not_clear_a_local_block(api, monkeypatch: pytest.MonkeyPatch):
    ensure_remote_policy_guard(monkeypatch)
    responses = [{"decision": "block"}, {"decision": "pass"}]

    def _reply(_request: Any) -> httpx.Response:
        return httpx.Response(200, json=responses.pop(0))

    api.post("/v1/policy/check").mock(side_effect=_reply)
    guard = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="open")
    tool = PaidTool("pay_seller")
    blocked = invoke_like_adk(
        botsrated_before_tool_callback(guard, ["pay_seller"]),
        tool,
        {"payment_context": ctx(FOUND["latest_probe"]["live_payTo"])},
        ToolContext(),
    )
    assert tool.calls == []
    assert set(blocked) == {BOTSRATED_PAYMENT_REASON}
    assert policy_calls(api)

    strict = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer", token=TOKEN, fail_mode="open")
    still_tool = PaidTool("pay_seller")
    still = invoke_like_adk(
        botsrated_before_tool_callback(strict, ["pay_seller"]),
        still_tool,
        {"payment_context": ctx(DEAD)},
        ToolContext(),
    )
    assert responses == []
    assert still_tool.calls == []
    assert list(still) == [BOTSRATED_PAYMENT_REASON]


@pytest.mark.parametrize(
    ("status", "body", "transport"),
    [
        (200, {"decision": None}, False),
        (503, {"decision": None}, False),
        (None, {}, True),
    ],
)
def test_fail_mode_closed_null_decision_does_not_run_the_tool(
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
    original = guard.decide

    def spy(payment: Any) -> Any:
        decision = original(payment)
        decisions.append(decision)
        return decision

    guard.decide = spy  # type: ignore[method-assign]
    tool = PaidTool("pay_seller")
    payment = ctx(FOUND["latest_probe"]["live_payTo"])
    result = invoke_like_adk(
        botsrated_before_tool_callback(guard, ["pay_seller"]),
        tool,
        payment,
        ToolContext(),
    )
    assert route.called
    assert tool.calls == []
    assert list(result) == [BOTSRATED_PAYMENT_REASON]
    assert decisions[0].action == "block"
    assert decisions[0].remote_decision is None


def test_fail_mode_open_null_decision_lets_the_tool_run(api, monkeypatch: pytest.MonkeyPatch):
    ensure_remote_policy_guard(monkeypatch)
    api.post("/v1/policy/check").respond(200, json={"decision": None})
    guard = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="open")
    decisions: list[Any] = []
    original = guard.decide

    def spy(payment: Any) -> Any:
        decision = original(payment)
        decisions.append(decision)
        return decision

    guard.decide = spy  # type: ignore[method-assign]
    tool = PaidTool("pay_seller")
    result = invoke_like_adk(
        botsrated_before_tool_callback(guard, ["pay_seller"]),
        tool,
        {"payment_context": ctx(FOUND["latest_probe"]["live_payTo"])},
        ToolContext(),
    )
    assert result == {"paid": True}
    assert len(tool.calls) == 1
    assert decisions[0].action == "allow"
    assert decisions[0].remote_decision is None
    assert any(
        reason.code == "remote_policy_unavailable" and reason.effect == "info" for reason in decisions[0].reasons
    )


def test_empty_paid_tools_is_rejected():
    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    with pytest.raises(ValueError):
        botsrated_before_tool_callback(guard, [])
    with pytest.raises(ValueError):
        botsrated_before_tool_callback(guard, "")
