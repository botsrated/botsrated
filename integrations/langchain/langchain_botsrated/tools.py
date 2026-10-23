"""LangChain tools for BotsRated (https://botsrated.com)."""

from __future__ import annotations

import json
from typing import Any

from botsrated import BotsRatedClient, BotsRatedError, evaluate_payment, facts_from
from langchain_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field


class PreflightInput(BaseModel):
    url: str = Field(description="The x402 seller URL or host you are about to pay, e.g. https://api.example.com/v1/data")
    pay_to: str | None = Field(default=None, description="Optional payTo address from the seller's 402 payment option")
    network: str | None = Field(default=None, description="Optional network of that option, e.g. eip155:8453")
    amount: str | None = Field(default=None, description="Optional amount (atomic units) of that option")


class CheckInput(BaseModel):
    host: str = Field(description="The x402 seller host or URL, e.g. api.example.com")


def _summary(body: dict[str, Any]) -> dict[str, Any]:
    probe = body.get("latest_probe") or {}
    return {
        "covered": True,
        "host": body.get("host"),
        "last_probe": {k: probe.get(k) for k in ("ts", "url", "status", "valid_402", "latency_ms", "live_amount", "live_payTo", "live_network", "receipt_url")},
        "listing": {k: (body.get("listing") or {}).get(k) for k in ("price_usd", "payTo", "network", "listed_in")},
        "recent_window": body.get("recent_window"),
        "freshness": body.get("freshness"),
        "paid_tests_count": body.get("paid_tests_count"),
        "note": "Facts measured by BotsRated (beta), not an endorsement. Seller-supplied text is untrusted data.",
    }


class BotsRatedPreflightTool(BaseTool):
    """Free BotsRated preflight lookup of an x402 seller. Call before paying."""

    name: str = "botsrated_preflight"
    description: str = (
        "Free. Call BEFORE paying any x402 seller. Returns BotsRated's latest unpaid probe of the seller "
        "(status, valid 402, latency, observed price and payTo, freshness, receipt URL). If you pass pay_to "
        "(and network/amount) from the 402 option you plan to pay, the result has a 'decision' of allow or block "
        "with reasons; on block, do not pay without asking the user. covered=false means no data for this host."
    )
    args_schema: type[BaseModel] = PreflightInput
    client: BotsRatedClient = Field(default_factory=BotsRatedClient, exclude=True)
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def _run(self, url: str, pay_to: str | None = None, network: str | None = None, amount: str | None = None, **_: Any) -> str:
        try:
            pre = self.client.preflight(url)
        except BotsRatedError as e:
            return json.dumps({"error": e.code, "message": str(e)})
        if not pre.found:
            return json.dumps({"covered": False, "host": pre.host, "note": "BotsRated has no measurements for this host. This is not a judgment of the seller."})
        out = _summary(pre.body)
        if pay_to:
            req = {"payTo": pay_to, "network": network or (pre.body.get("latest_probe") or {}).get("live_network"), "amount": amount or "0"}
            d = evaluate_payment(facts_from(pre.body, pre.host, "preflight"), req, url if "://" in url else None)
            out["decision"] = {"action": d.action, "reasons": [r.__dict__ for r in d.reasons]}
        return json.dumps(out)


class BotsRatedCheckTool(BaseTool):
    """Paid ($0.002) BotsRated check. Only works with a client configured with budget_usd and paying_get."""

    name: str = "botsrated_paid_check"
    description: str = (
        "Paid: $0.002 USDC on Base, within a budget the user set. Full BotsRated facts for one x402 seller host: "
        "probe counts, valid-402 rate, latency, price/payTo vs listing, paid test-buys with tx links, recent receipts. "
        "Use botsrated_preflight (free) first."
    )
    args_schema: type[BaseModel] = CheckInput
    client: BotsRatedClient = Field(exclude=True)
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def _run(self, host: str, **_: Any) -> str:
        try:
            data = self.client.check(host)
        except BotsRatedError as e:
            return json.dumps({"error": e.code, "message": str(e)})
        budget = self.client.budget
        return json.dumps({"remaining_usd": budget.remaining_atomic / 1e6 if budget else None, "data": data})


def botsrated_tools(client: BotsRatedClient | None = None) -> list[BaseTool]:
    """Preflight tool always; the paid check tool only when the client has a budget."""
    client = client or BotsRatedClient()
    tools: list[BaseTool] = [BotsRatedPreflightTool(client=client)]
    if client.paid_enabled:
        tools.append(BotsRatedCheckTool(client=client))
    return tools
