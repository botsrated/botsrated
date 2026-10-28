"""before_tool_execute calls the same guard. No agent run and no model call."""

from __future__ import annotations

import asyncio
import copy
import inspect
from collections.abc import Mapping
from types import SimpleNamespace
from typing import Any

import pytest

pytest.importorskip("pydantic_ai", reason="optional hooks extra is not installed")

from support import (  # noqa: E402
    DEAD,
    FOUND,
    TOKEN,
    RecordingClientSync,
    ctx,
    ensure_remote_policy_guard,
    policy_calls,
)

from pydantic_ai_botsrated import attach_payment_guard, botsrated_payment_hooks  # noqa: E402


def _call(hooks: Any, tool_name: str, args: Mapping[str, Any]) -> Any:
    async def _run() -> Any:
        return await hooks.before_tool_execute(
            None,
            call=SimpleNamespace(tool_name=tool_name),
            tool_def=None,
            args=args,
        )

    return asyncio.run(_run())


def test_public_hooks_types_match_the_pinned_surface():
    import pydantic_ai
    from pydantic_ai.capabilities import Hooks
    from pydantic_ai.exceptions import ModelRetry, SkipToolExecution, ToolFailed

    version = tuple(int(part) for part in pydantic_ai.__version__.split(".")[:2])
    assert version >= (2, 0)
    assert version < (3, 0)
    registration = type(Hooks().on)
    assert "tools" in inspect.signature(registration.before_tool_execute).parameters
    assert "message" in inspect.signature(ToolFailed).parameters
    assert "result" in inspect.signature(SkipToolExecution).parameters
    assert not issubclass(ToolFailed, ModelRetry)


def test_named_paid_tool_block_raises_tool_failed_and_does_not_run_a_tool(api):
    from pydantic_ai.exceptions import ModelRetry, ToolFailed

    guard = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer")
    seen: list[Any] = []
    original = guard.decide

    def spy(payment: Any) -> Any:
        seen.append(payment)
        return original(payment)

    guard.decide = spy  # type: ignore[method-assign]
    ran: list[str] = []

    def pay() -> None:
        ran.append("pay")

    hooks = botsrated_payment_hooks(guard, paid_tools={"pay_seller"})
    entry = hooks._registry["before_tool_execute"][0]
    assert entry.tools == frozenset({"pay_seller"})
    assert set(hooks._registry) == {"before_tool_execute"}
    tool_args = {"payment_context": ctx(DEAD), "pay": pay}
    before = copy.deepcopy({key: value for key, value in tool_args.items() if key != "pay"})
    with pytest.raises(ToolFailed) as exc:
        _call(hooks, "pay_seller", tool_args)
    assert not isinstance(exc.value, ModelRetry)
    assert "Payment stopped by your payment policy" in exc.value.message
    assert ran == []
    assert tool_args["payment_context"] == before["payment_context"]
    assert seen and seen[0]["selected_requirements"]["payTo"] == DEAD


def test_mapping_keys_are_the_paid_tool_names_and_other_tools_are_left_alone(api):
    from pydantic_ai.exceptions import ToolFailed

    guard = attach_payment_guard(RecordingClientSync(), preset="strict")

    def boom(_payment: Any) -> Any:
        raise AssertionError("guard was asked about a tool that is not named")

    guard.decide = boom  # type: ignore[method-assign]
    hooks = botsrated_payment_hooks(guard, paid_tools={"pay_seller": "ignored", "pay_other": True})
    other_args = {"payment_context": ctx(DEAD)}
    assert _call(hooks, "search", other_args) is other_args
    with pytest.raises(ToolFailed):
        _call(hooks, "pay_seller", {"x402": ctx(DEAD)})
    with pytest.raises(ToolFailed):
        _call(hooks, "pay_other", {"payment": ctx(DEAD)})


def test_payment_required_on_the_args_is_the_context(api):
    from pydantic_ai.exceptions import ToolFailed

    guard = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer")
    hooks = botsrated_payment_hooks(guard, ["pay_seller"])
    quote = ctx(DEAD)
    args = {
        "payment_required": quote["payment_required"],
        "selected_requirements": quote["selected_requirements"],
    }
    before = copy.deepcopy(args)
    with pytest.raises(ToolFailed):
        _call(hooks, "pay_seller", args)
    assert args == before


def test_omitted_preset_hook_does_not_block_an_unobserved_payto(api):
    guard = attach_payment_guard(RecordingClientSync())
    hooks = botsrated_payment_hooks(guard, paid_tools={"pay_seller"})
    args = {"payment": ctx(DEAD)}
    before = copy.deepcopy(args)
    assert _call(hooks, "pay_seller", args) is args
    assert args == before


def test_missing_payment_context_blocks_the_named_tool_without_calling_the_guard():
    from pydantic_ai.exceptions import ToolFailed

    guard = attach_payment_guard(RecordingClientSync(), preset="warn")

    def boom(_payment: Any) -> Any:
        raise AssertionError("guard was asked")

    guard.decide = boom  # type: ignore[method-assign]
    hooks = botsrated_payment_hooks(guard, {"pay_seller"})
    args = {"query": "hello"}
    before = copy.deepcopy(args)
    with pytest.raises(ToolFailed) as exc:
        _call(hooks, "pay_seller", args)
    assert "could not be read" in exc.value.message
    assert args == before
    untouched = {"query": "hello"}
    assert _call(hooks, "search", untouched) is untouched


def test_hook_blocks_when_the_guard_raises():
    from contextlib import contextmanager

    from pydantic_ai.exceptions import ToolFailed

    class Boom:
        def request(self, _url: str):
            @contextmanager
            def _cm():
                yield

            return _cm()

        def decide(self, _payment: Any) -> Any:
            raise RuntimeError("boom")

    hooks = botsrated_payment_hooks(Boom(), {"pay_seller"})
    with pytest.raises(ToolFailed) as exc:
        _call(hooks, "pay_seller", {"payment_context": ctx(DEAD)})
    assert "could not evaluate" in exc.value.message


def test_hook_remote_block_stops_and_pass_does_not_clear_a_local_block(api, monkeypatch: pytest.MonkeyPatch):
    from pydantic_ai.exceptions import ToolFailed

    ensure_remote_policy_guard(monkeypatch)
    api.post("/v1/policy/check").respond(200, json={"decision": "block"})
    guard = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="open")
    hooks = botsrated_payment_hooks(guard, paid_tools={"pay_seller"})
    observed = FOUND["latest_probe"]["live_payTo"]
    args = {"x402": ctx(observed), "keep": "yes"}
    before = copy.deepcopy(args)
    with pytest.raises(ToolFailed) as exc:
        _call(hooks, "pay_seller", args)
    assert args == before
    assert "Payment stopped by your payment policy" in exc.value.message
    assert policy_calls(api)

    api.post("/v1/policy/check").respond(200, json={"decision": "pass"})
    strict = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer", token=TOKEN, fail_mode="open")
    strict_hooks = botsrated_payment_hooks(strict, paid_tools=["pay_seller"])
    quote = ctx(DEAD)
    blocked = {
        "payment_required": quote["payment_required"],
        "selected_requirements": quote["selected_requirements"],
    }
    with pytest.raises(ToolFailed):
        _call(strict_hooks, "pay_seller", blocked)
    with strict.request(FOUND["latest_probe"]["url"]):
        decision = strict.decide(ctx(DEAD))
    assert decision.action == "block"
    assert any(reason.code == "payto_not_observed" and reason.effect == "block" for reason in decision.reasons)


def test_hook_closed_null_decision_blocks_and_open_does_not_invent_a_pass(api, monkeypatch: pytest.MonkeyPatch):
    from pydantic_ai.exceptions import ToolFailed

    ensure_remote_policy_guard(monkeypatch)
    api.post("/v1/policy/check").respond(200, json={"decision": None})
    observed = FOUND["latest_probe"]["live_payTo"]
    closed = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="closed")
    closed_hooks = botsrated_payment_hooks(closed, {"pay_seller"})
    with pytest.raises(ToolFailed):
        _call(closed_hooks, "pay_seller", {"payment_context": ctx(observed)})
    opened = attach_payment_guard(RecordingClientSync(), preset="warn", token=TOKEN, fail_mode="open")
    opened_hooks = botsrated_payment_hooks(opened, {"pay_seller"})
    args = {"payment_context": ctx(observed)}
    assert _call(opened_hooks, "pay_seller", args) is args


def test_skip_tool_execution_when_tool_failed_is_absent(api, monkeypatch: pytest.MonkeyPatch):
    import pydantic_ai.exceptions as exceptions

    monkeypatch.delattr(exceptions, "ToolFailed")
    guard = attach_payment_guard(RecordingClientSync(), preset="carefulBuyer")
    hooks = botsrated_payment_hooks(guard, {"pay_seller"})
    with pytest.raises(exceptions.SkipToolExecution) as exc:
        _call(hooks, "pay_seller", {"payment_context": ctx(DEAD)})
    assert isinstance(exc.value.result, str)
    assert "Payment stopped by your payment policy" in exc.value.result


def test_empty_paid_tools_is_rejected():
    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    with pytest.raises(ValueError):
        botsrated_payment_hooks(guard, set())
    with pytest.raises(ValueError):
        botsrated_payment_hooks(guard, {"": True})
    with pytest.raises(ValueError):
        botsrated_payment_hooks(guard, "")


def test_hooks_do_not_construct_an_agent():
    from pydantic_ai.capabilities import Hooks

    guard = attach_payment_guard(RecordingClientSync(), preset="warn")
    hooks = botsrated_payment_hooks(guard, "pay_seller")
    assert isinstance(hooks, Hooks)
    assert type(hooks).__name__ == "Hooks"
