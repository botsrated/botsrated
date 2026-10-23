"""Pre-payment guard: decide whether to pay an x402 seller, using BotsRated's measurements."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlsplit

from botsrated.client import BotsRatedClient, BotsRatedError, extensions_ok, host_of, usd_to_atomic

Effect = Literal["block", "warn", "info"]


@dataclass
class Reason:
    code: str
    detail: str
    effect: Effect


@dataclass
class SellerFacts:
    covered: bool
    host: str
    source: Literal["preflight", "check"]
    known_pay_tos: list[str] = field(default_factory=list)  # payTos BotsRated's own probes observed
    listing_pay_to: str | None = None  # from the seller's directory listing (seller-controlled)
    observed_network: str | None = None
    probed_url: str | None = None
    observed_amount: str | None = None
    valid_402_rate: float | None = None
    recent_probes: int | None = None
    stale: bool | None = None
    last_probe_at: str | None = None
    receipt_url: str | None = None


@dataclass
class Decision:
    action: Literal["allow", "block"]
    host: str | None
    reasons: list[Reason]
    facts: SellerFacts | None = None

    def summary(self) -> str:
        blocking = [r for r in self.reasons if r.effect == "block"] or self.reasons
        listed = "; ".join(f"{r.code}: {r.detail}" for r in blocking)
        receipt = f" (receipt: {self.facts.receipt_url})" if self.facts and self.facts.receipt_url else ""
        verb = "blocked" if self.action == "block" else "allowed"
        return f"BotsRated pre-payment check {verb} {self.host or 'payment'}" + (f" - {listed}" if listed else "") + receipt


@dataclass
class GuardPolicy:
    not_covered: Literal["allow", "block"] = "allow"
    pay_to_mismatch: Literal["allow", "warn", "block"] = "block"
    price_above_observed: Literal["allow", "warn", "block"] = "warn"
    stale: Literal["allow", "block"] = "allow"
    min_valid_402_rate: float | None = None


def facts_from(body: dict[str, Any], host: str, source: Literal["preflight", "check"]) -> SellerFacts:
    probe = body.get("latest_probe") or (body.get("receipts") or [{}])[0] or {}
    measured = body.get("measured") or {}
    listing = body.get("listing") or {}
    rw = body.get("recent_window") or measured.get("recent_window") or {}
    # Only BotsRated's own observations confirm a payTo; the listing is seller-controlled.
    pay_tos = [probe.get("live_payTo"), measured.get("last_quoted_payTo")]
    freshness = body.get("freshness") or {}
    return SellerFacts(
        covered=body.get("found") is not False,
        host=host,
        source=source,
        known_pay_tos=sorted({p.lower() for p in pay_tos if isinstance(p, str) and p}),
        listing_pay_to=listing.get("payTo").lower() if isinstance(listing.get("payTo"), str) and listing.get("payTo") else None,
        observed_network=probe.get("live_network") or listing.get("network"),
        probed_url=probe.get("url") or (body.get("route_probed") or {}).get("url"),
        observed_amount=probe.get("live_amount") or measured.get("last_quoted_amount_atomic"),
        valid_402_rate=rw.get("valid_402_rate"),
        recent_probes=rw.get("probes"),
        stale=freshness.get("stale"),
        last_probe_at=freshness.get("last_probe_at"),
        receipt_url=probe.get("receipt_url"),
    )


def _same_route(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    x, y = urlsplit(a), urlsplit(b)
    return (x.hostname or "") == (y.hostname or "") and x.path.rstrip("/") == y.path.rstrip("/")


def as_requirements(req: Any) -> dict[str, Any]:
    """Accepts a dict or an x402 ``PaymentRequirements`` model; returns camelCase keys."""
    if isinstance(req, dict):
        d = dict(req)
    elif hasattr(req, "model_dump"):
        d = req.model_dump(by_alias=True)
    else:
        d = {k: getattr(req, k, None) for k in ("scheme", "network", "asset", "amount", "pay_to")}
    if "payTo" not in d and "pay_to" in d:
        d["payTo"] = d["pay_to"]
    return d


def evaluate_payment(facts: SellerFacts, req: dict[str, Any], resource_url: str | None, policy: GuardPolicy | None = None) -> Decision:
    p = policy or GuardPolicy()
    reasons: list[Reason] = []

    def add(code: str, detail: str, effect: str) -> None:
        if effect != "allow":
            reasons.append(Reason(code, detail, effect))  # type: ignore[arg-type]

    req = as_requirements(req)
    pay_to = str(req.get("payTo") or "")
    amount = str(req.get("amount") or "")
    if not facts.covered:
        add("not_covered", f"{facts.host} is not in BotsRated's probe set", "block" if p.not_covered == "block" else "info")
    else:
        if facts.observed_network and facts.observed_network != req.get("network"):
            add("network_not_measured", f"paying on {req.get('network')}; BotsRated measured {facts.observed_network}", "info")
        elif facts.known_pay_tos and pay_to.lower() not in facts.known_pay_tos:
            add(
                "payto_mismatch",
                f"payTo {pay_to} was never seen by BotsRated for {facts.host} (seen: {', '.join(facts.known_pay_tos)})",
                p.pay_to_mismatch,
            )
        elif not facts.known_pay_tos and facts.listing_pay_to:
            if pay_to.lower() == facts.listing_pay_to:
                add("payto_listing_only", f"payTo {pay_to} matches {facts.host}'s listing but no BotsRated probe has observed it yet", "info")
            else:
                add("payto_mismatch", f"payTo {pay_to} differs from {facts.host}'s listing ({facts.listing_pay_to})", p.pay_to_mismatch)
        if (
            facts.observed_amount
            and str(facts.observed_amount).isdigit()
            and amount.isdigit()
            and _same_route(resource_url, facts.probed_url)
            and int(amount) > int(facts.observed_amount)
        ):
            add("price_above_observed", f"quoted {amount} atomic; BotsRated last observed {facts.observed_amount} on this route", p.price_above_observed)
        if facts.stale:
            add("stale", f"BotsRated data is older than 24 h (last probe {facts.last_probe_at})", "block" if p.stale == "block" else "info")
        if (
            p.min_valid_402_rate is not None
            and facts.valid_402_rate is not None
            and (facts.recent_probes or 0) >= 3
            and facts.valid_402_rate < p.min_valid_402_rate
        ):
            add("low_valid_402_rate", f"recent valid-402 rate {facts.valid_402_rate} is below {p.min_valid_402_rate}", "block")
    action: Literal["allow", "block"] = "block" if any(r.effect == "block" for r in reasons) else "allow"
    return Decision(action, facts.host, reasons, facts)


class PrePaymentGuard:
    """Decides on x402 payments using BotsRated's free preflight (and, opt-in, a paid check).

    Args:
        client: A ``BotsRatedClient``; a free-only client is created if omitted.
        policy: What to block or warn on.
        fail_open: Allow the payment when BotsRated is unreachable. Default True.
        paid_check_at_or_above_usd: Run a check for payments at or above this: free within the daily quota
            (100/day), then a $0.001 paid check with a paid-enabled client (skipped otherwise).
        on_decision: Called with every decision.
    """

    def __init__(
        self,
        client: BotsRatedClient | None = None,
        policy: GuardPolicy | None = None,
        *,
        fail_open: bool = True,
        paid_check_at_or_above_usd: float | None = None,
        on_decision: Callable[[Decision], None] | None = None,
    ) -> None:
        self.client = client or BotsRatedClient()
        self.policy = policy or GuardPolicy()
        self.fail_open = fail_open
        self.paid_threshold = paid_check_at_or_above_usd
        self.on_decision = on_decision

    def decide(self, resource_url: str | None, requirements: Any) -> Decision:
        req = as_requirements(requirements)
        if not resource_url:
            eff: Effect = "info" if self.fail_open else "block"
            return Decision("allow" if self.fail_open else "block", None, [Reason("no_resource_url", "payment has no resource URL", eff)])
        host = host_of(resource_url)
        if host == self.client.host:
            ok = self.client.is_reserved_payment(req)
            reasons = [] if ok else [Reason("botsrated_payment_not_reserved", "payments to BotsRated must go through BotsRatedClient with a budget", "block")]
            return Decision("allow" if ok else "block", host, reasons)
        try:
            pre = self.client.preflight(resource_url)
            facts = facts_from(pre.body, host, "preflight")
            extra: list[Reason] = []
            if (
                pre.found
                and self.paid_threshold is not None
                and str(req.get("amount", "")).isdigit()
                and int(req["amount"]) >= usd_to_atomic(self.paid_threshold)
            ):
                try:
                    facts = facts_from(self.client.check(host), host, "check")
                except BotsRatedError as e:
                    extra.append(Reason("paid_check_skipped", str(e), "info"))
            d = evaluate_payment(facts, req, resource_url, self.policy)
            d.reasons.extend(extra)
            return d
        except BotsRatedError as e:
            eff = "info" if self.fail_open else "block"
            return Decision("allow" if self.fail_open else "block", host, [Reason("botsrated_unavailable", str(e), eff)])

    def x402_hook(self, context: Any) -> Any:
        """Hook for ``x402Client(Sync).on_before_payment_creation``. Returns ``AbortResult`` to block."""
        pr = context.payment_required
        resource = getattr(pr, "resource", None)
        url = getattr(resource, "url", None) if resource is not None else None
        d = self.decide(url, context.selected_requirements)
        if url and d.action == "allow" and host_of(url) == self.client.host:
            # A BotsRated payment is a one-shot EIP-3009 transfer: refuse payment extensions (e.g. an
            # ERC-20 approval of Permit2) and never hand any extensions to the signer.
            if not extensions_ok(getattr(pr, "extensions", None)):
                d = Decision("block", d.host, [Reason("botsrated_payment_extensions", "BotsRated quotes must not carry payment extensions", "block")])
            else:
                pr.extensions = None
        if self.on_decision:
            self.on_decision(d)
        if d.action == "block":
            from x402 import AbortResult  # optional dependency: botsrated[x402]

            return AbortResult(reason=d.summary())
        return None
