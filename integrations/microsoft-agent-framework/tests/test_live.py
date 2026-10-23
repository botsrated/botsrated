"""Live tests: they call the real, free BotsRated preflight (REST and MCP). Nothing is paid.

pytest -m live
"""

import json

import pytest
from agent_framework import Agent, MCPStreamableHTTPTool
from botsrated import BotsRatedClient
from conftest import ScriptedModel, results

from agent_framework_botsrated import BOTSRATED_MCP_URL, BotsRatedPaymentMiddleware, botsrated_check_payment_tool

pytestmark = pytest.mark.live

SELLER = "https://blockrun.ai/api/v1/chat/completions"
UNKNOWN = "0x000000000000000000000000000000000000dEaD"
FREE_TOOLS = {"preflight", "coverage", "sample", "history"}


def observed_pay_to() -> str:
    pre = BotsRatedClient().preflight(SELLER)
    assert pre.found, "blockrun.ai should be covered by BotsRated"
    return pre.body["latest_probe"]["live_payTo"]


paid: list[str] = []


def pay_x402(url: str, pay_to: str, amount: str, network: str = "eip155:8453") -> str:
    """Pay an x402 seller (stub: nothing is paid)."""
    paid.append(pay_to)
    return "PAID"


async def test_middleware_against_live_preflight() -> None:
    good = observed_pay_to()
    model = ScriptedModel(
        [
            ("bad", "pay_x402", {"url": SELLER, "pay_to": UNKNOWN, "amount": "2000"}),
            ("good", "pay_x402", {"url": SELLER, "pay_to": good, "amount": "2000"}),
        ]
    )
    agent = Agent(client=model, tools=[pay_x402], middleware=[BotsRatedPaymentMiddleware(["pay_x402"])])
    out = results(await agent.run("pay"))
    assert paid == [good]
    assert "payto_mismatch" in str(out["bad"]) and "receipt" in str(out["bad"])


async def test_check_payment_tool_live() -> None:
    t = botsrated_check_payment_tool()
    blocked = json.loads((await t.invoke(url=SELLER, pay_to=UNKNOWN, amount="2000"))[0].text)
    assert blocked["action"] == "block" and blocked["reasons"][0]["code"] == "payto_mismatch"
    allowed = json.loads((await t.invoke(url=SELLER, pay_to=observed_pay_to(), amount="2000"))[0].text)
    assert allowed["action"] == "allow", allowed


async def test_hosted_mcp_server_free_tools() -> None:
    async with MCPStreamableHTTPTool(name="botsrated", url=BOTSRATED_MCP_URL, allowed_tools=FREE_TOOLS) as mcp:
        names = {f.name for f in mcp.functions}
        assert names == FREE_TOOLS
        preflight = next(f for f in mcp.functions if f.name == "preflight")
        out = await preflight.invoke(url="blockrun.ai")
        text = " ".join(str(getattr(c, "text", None) or c) for c in out)
        assert "blockrun.ai" in text and '"found":true' in text.replace(" ", "")


async def test_agent_calls_hosted_preflight_through_mcp() -> None:
    mcp = MCPStreamableHTTPTool(name="botsrated", url=BOTSRATED_MCP_URL, allowed_tools=FREE_TOOLS)
    model = ScriptedModel([("pf", "preflight", {"url": "blockrun.ai"})])
    async with mcp:
        out = results(await Agent(client=model, tools=[mcp]).run("Is blockrun.ai known?"))
    assert "blockrun.ai" in str(out["pf"])
