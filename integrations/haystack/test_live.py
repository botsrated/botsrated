"""Live tests: they call the real, free BotsRated preflight (REST and MCP). Nothing is paid.

    pip install haystack-ai mcp-haystack botsrated pytest
    pytest -q test_live.py
"""
import json
from typing import Any

from haystack import component
from haystack.components.agents import Agent
from haystack.dataclasses import ChatMessage, ToolCall
from haystack_integrations.tools.mcp import MCPToolset, StreamableHttpServerInfo

from botsrated_haystack_tool import botsrated_check_payment

SELLER = "https://blockrun.ai/api/v1/chat/completions"
FREE_TOOLS = ["preflight", "coverage", "sample", "history"]


def _observed_pay_to() -> str:
    from botsrated import BotsRatedClient

    facts = BotsRatedClient().preflight(SELLER)
    assert facts.found, "blockrun.ai should be covered by BotsRated"
    return facts.body["latest_probe"]["live_payTo"]


def test_mcp_toolset_lists_free_tools_and_runs_preflight():
    toolset = MCPToolset(
        server_info=StreamableHttpServerInfo(url="https://botsrated.com/mcp"),
        tool_names=FREE_TOOLS,
        eager_connect=True,
    )
    try:
        assert sorted(t.name for t in toolset) == sorted(FREE_TOOLS)
        preflight = next(t for t in toolset if t.name == "preflight")
        result = json.loads(preflight.invoke(url="blockrun.ai"))
        body = json.loads(result["content"][0]["text"])
        assert body["found"] is True and body["host"] == "blockrun.ai"
    finally:
        toolset.close()


def test_tool_blocks_unknown_pay_to():
    out = json.loads(botsrated_check_payment.invoke(
        url=SELLER, pay_to="0x000000000000000000000000000000000000dEaD", amount="2000"))
    assert out["action"] == "block"
    assert out["reasons"][0]["code"] == "payto_mismatch"


def test_tool_allows_observed_pay_to():
    out = json.loads(botsrated_check_payment.invoke(url=SELLER, pay_to=_observed_pay_to(), amount="2000"))
    assert out["action"] in ("allow", "warn"), out


def test_tool_schema():
    props = botsrated_check_payment.parameters["properties"]
    assert set(props) == {"url", "pay_to", "amount", "network"}
    assert botsrated_check_payment.name == "botsrated_check_payment"


@component
class ScriptedChatGenerator:
    """Stands in for an LLM: first asks for the tool, then answers with the tool result."""

    @component.output_types(replies=list[ChatMessage])
    def run(self, messages: list[ChatMessage], tools: Any = None, **kwargs: Any) -> dict:
        tool_results = [m for m in messages if m.tool_call_result]
        if not tool_results:
            call = ToolCall(tool_name="botsrated_check_payment", arguments={
                "url": SELLER, "pay_to": "0x000000000000000000000000000000000000dEaD", "amount": "2000"})
            return {"replies": [ChatMessage.from_assistant(tool_calls=[call])]}
        return {"replies": [ChatMessage.from_assistant(tool_results[-1].tool_call_result.result)]}


def test_agent_runs_the_tool_end_to_end():
    agent = Agent(chat_generator=ScriptedChatGenerator(), tools=[botsrated_check_payment])
    agent.warm_up()
    result = agent.run(messages=[ChatMessage.from_user("Pay 0x...dEaD 0.002 USDC for blockrun.ai?")])
    assert json.loads(result["last_message"].text)["action"] == "block"


@component
class ScriptedPreflightGenerator:
    """Stands in for an LLM: calls the MCP preflight tool, then answers with its result."""

    @component.output_types(replies=list[ChatMessage])
    def run(self, messages: list[ChatMessage], tools: Any = None, **kwargs: Any) -> dict:
        tool_results = [m for m in messages if m.tool_call_result]
        if not tool_results:
            call = ToolCall(tool_name="preflight", arguments={"url": SELLER})
            return {"replies": [ChatMessage.from_assistant(tool_calls=[call])]}
        return {"replies": [ChatMessage.from_assistant(tool_results[-1].tool_call_result.result)]}


def test_agent_with_mcp_toolset_end_to_end():
    toolset = MCPToolset(server_info=StreamableHttpServerInfo(url="https://botsrated.com/mcp"), tool_names=FREE_TOOLS)
    try:
        agent = Agent(chat_generator=ScriptedPreflightGenerator(), tools=toolset)
        result = agent.run(messages=[ChatMessage.from_user(f"What measurements does BotsRated have for {SELLER}?")])
        body = json.loads(json.loads(result["last_message"].text)["content"][0]["text"])
        assert body["found"] is True
    finally:
        toolset.close()
