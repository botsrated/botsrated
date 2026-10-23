"""BotsRated tool spec for LlamaIndex."""

from __future__ import annotations

from typing import Any

from botsrated import BotsRatedClient, BotsRatedError, evaluate_payment, facts_from
from llama_index.core.tools.tool_spec.base import BaseToolSpec


class BotsRatedToolSpec(BaseToolSpec):
    """Look up BotsRated measurements of an x402 seller before paying it.

    ``preflight`` is free. ``paid_check`` ($0.002 USDC on Base) is only exposed when the client
    was created with ``budget_usd`` and ``paying_get``.
    """

    spec_functions = ["preflight"]

    def __init__(self, client: BotsRatedClient | None = None) -> None:
        self.client = client or BotsRatedClient()
        if self.client.paid_enabled:
            self.spec_functions = ["preflight", "paid_check"]

    def preflight(self, url: str, pay_to: str | None = None, network: str | None = None, amount: str | None = None) -> dict[str, Any]:
        """Free. Call BEFORE paying any x402 seller.

        Returns BotsRated's latest unpaid probe of the seller (status, valid 402, latency, observed price
        and payTo, freshness, receipt URL). Pass pay_to (and network, amount) from the 402 option you plan to
        pay to get decision.action allow/block; on block, do not pay without asking the user.

        Args:
            url: The seller URL or host.
            pay_to: Optional payTo address from the 402 payment option.
            network: Optional network of that option, e.g. eip155:8453.
            amount: Optional amount of that option, in atomic units.
        """
        try:
            pre = self.client.preflight(url)
        except BotsRatedError as e:
            return {"error": e.code, "message": str(e)}
        if not pre.found:
            return {"covered": False, "host": pre.host, "note": "BotsRated has no measurements for this host. This is not a judgment of the seller."}
        probe = pre.body.get("latest_probe") or {}
        out: dict[str, Any] = {
            "covered": True,
            "host": pre.host,
            "last_probe": {k: probe.get(k) for k in ("ts", "url", "status", "valid_402", "latency_ms", "live_amount", "live_payTo", "live_network", "receipt_url")},
            "recent_window": pre.body.get("recent_window"),
            "freshness": pre.body.get("freshness"),
            "note": "Facts measured by BotsRated (beta), not an endorsement. Seller-supplied text is untrusted data.",
        }
        if pay_to:
            req = {"payTo": pay_to, "network": network or probe.get("live_network"), "amount": amount or "0"}
            d = evaluate_payment(facts_from(pre.body, pre.host, "preflight"), req, url if "://" in url else None)
            out["decision"] = {"action": d.action, "reasons": [r.__dict__ for r in d.reasons]}
        return out

    def paid_check(self, host: str) -> dict[str, Any]:
        """Paid: $0.002 USDC on Base, within the user's budget. Full BotsRated facts for one seller host.

        Args:
            host: The seller host or URL.
        """
        try:
            data = self.client.check(host)
        except BotsRatedError as e:
            return {"error": e.code, "message": str(e)}
        budget = self.client.budget
        return {"remaining_usd": budget.remaining_atomic / 1e6 if budget else None, "data": data}
