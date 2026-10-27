"""Pre-payment guard: decide whether to pay an x402 seller, using BotsRated's measurements."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, TypeVar
from urllib.parse import urlsplit

from botsrated.client import (
    BotsRatedClient,
    BotsRatedError,
    current_request_url,
    extensions_ok,
    paying_request,
    usd_to_atomic,
)
from botsrated.util import (
    DISPUTE_URL,
    clean_text,
    is_address,
    is_atomic_amount,
    same_site_host,
    try_host_of,
)

MEASUREMENT_NOTE = "This is a measurement, not a finding about the seller."

T = TypeVar("T")

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
    dispute_url: str = DISPUTE_URL

    def summary(self) -> str:
        """Fact-only text with the dispute link. Seller text is never echoed beyond a parsed host name."""
        blocking = [r for r in self.reasons if r.effect == "block"]
        receipt_url = self.facts.receipt_url if self.facts else None
        receipt = f" Receipt: {clean_text(receipt_url, 200)}." if isinstance(receipt_url, str) and receipt_url.startswith(("https://botsrated.com/", "https://www.botsrated.com/")) else ""
        if self.action == "block" and blocking:
            r = blocking[0]
            text = f"Payment stopped by your payment policy (rule: {r.code}). Fact: {r.detail}{receipt} {MEASUREMENT_NOTE} Dispute: {self.dispute_url}"
        else:
            listed = " ".join(f"{r.code}: {r.detail}" for r in self.reasons) or "no rule matched."
            text = f"BotsRated pre-payment check for {self.host or 'this payment'}: {listed}{receipt} {MEASUREMENT_NOTE} Dispute: {self.dispute_url}"
        return clean_text(text, 700)


@dataclass
class GuardPolicy:
    not_covered: Literal["allow", "block"] = "allow"
    # payTo not among the payTos BotsRated's probes recorded (or not an address). Default "warn" since 0.2.0
    # (was "block"); use STRICT_GUARD_POLICY or pay_to_mismatch="block" to stop those payments.
    pay_to_mismatch: Literal["allow", "warn", "block"] = "warn"
    price_above_observed: Literal["allow", "warn", "block"] = "warn"
    stale: Literal["allow", "block"] = "allow"
    min_valid_402_rate: float | None = None
    # Block an x402 hook payment when the request URL being paid is unknown (no ``paying_request`` /
    # ``wrap_get`` / ``x402_hook_for``). Off by default: the host is then read from the 402's resource.url.
    require_request_url: bool = False


# The pre-0.2.0 behavior as an explicit choice: stop payments whose payTo BotsRated's probes did not record.
# Since 0.2.0 it also sets require_request_url, so a payment whose real request URL is unknown is stopped too
# (use ``wrap_get`` or ``x402_hook_for``).
STRICT_GUARD_POLICY = GuardPolicy(pay_to_mismatch="block", require_request_url=True)


def facts_from(body: dict[str, Any], host: str, source: Literal["preflight", "check"]) -> SellerFacts:
    probe = body.get("latest_probe") or (body.get("receipts") or [{}])[0] or {}
    measured = body.get("measured") or {}
    listing = body.get("listing") or {}
    rw = body.get("recent_window") or measured.get("recent_window") or {}
    # Only BotsRated's own observations confirm a payTo; the listing is seller-controlled.
    pay_tos = [probe.get("live_payTo"), measured.get("last_quoted_payTo")]
    freshness = body.get("freshness") or {}
    listing_pay_to = listing.get("payTo")
    return SellerFacts(
        covered=body.get("found") is not False,
        host=host,
        source=source,
        known_pay_tos=sorted({p.lower() for p in pay_tos if isinstance(p, str) and p}),
        listing_pay_to=listing_pay_to.lower() if isinstance(listing_pay_to, str) and listing_pay_to else None,
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
    try:
        x, y = urlsplit(a), urlsplit(b)
    except ValueError:
        return False
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
    raw_pay_to = req.get("payTo")
    amount = str(req.get("amount") or "")
    host = clean_text(facts.host, 253)
    network = clean_text(req.get("network"), 40)
    if not facts.covered:
        add("not_covered", f"BotsRated has no probe record for {host}.", "block" if p.not_covered == "block" else "info")
    else:
        observed = clean_text(facts.observed_network, 40) if facts.observed_network else None
        known = [x.lower() for x in facts.known_pay_tos if is_address(x)]
        listing = facts.listing_pay_to.lower() if is_address(facts.listing_pay_to) else None
        if not is_address(raw_pay_to):
            add("payto_invalid", "the payTo in this payment request is not a 20-byte hex address.", p.pay_to_mismatch)
        elif observed and observed != network:
            add("network_not_observed", f"BotsRated's probes recorded {host} on {observed}, not on {network}.", "info")
        elif known and raw_pay_to.lower() not in known:
            add(
                "payto_not_observed",
                f"the payTo in this payment request is not among the payTo addresses BotsRated's probes recorded for {host} on {observed or network}.",
                p.pay_to_mismatch,
            )
        elif not known and listing:
            if raw_pay_to.lower() == listing:
                add("payto_listing_only", f"the payTo matches {host}'s directory listing; BotsRated's probes have not recorded a payTo for {host} yet.", "info")
            else:
                add(
                    "payto_not_observed",
                    f"the payTo in this payment request differs from the payTo in {host}'s directory listing; BotsRated's probes have not recorded a payTo for {host} yet.",
                    p.pay_to_mismatch,
                )
        if (
            facts.observed_amount
            and is_atomic_amount(str(facts.observed_amount))
            and is_atomic_amount(amount)
            and _same_route(resource_url, facts.probed_url)
            and int(amount) > int(facts.observed_amount)
        ):
            add(
                "price_above_observed",
                f"the quoted amount ({amount} atomic units) is above the last amount BotsRated recorded on this route ({facts.observed_amount}).",
                p.price_above_observed,
            )
        if facts.stale:
            add("data_stale", f"BotsRated's latest probe of {host} is older than 24 hours.", "block" if p.stale == "block" else "info")
        if (
            p.min_valid_402_rate is not None
            and facts.valid_402_rate is not None
            and (facts.recent_probes or 0) >= 3
            and facts.valid_402_rate < p.min_valid_402_rate
        ):
            add(
                "low_valid_402_rate",
                f"the recent valid-402 rate BotsRated measured ({facts.valid_402_rate}) is below your minimum ({p.min_valid_402_rate}).",
                "block",
            )
    action: Literal["allow", "block"] = "block" if any(r.effect == "block" for r in reasons) else "allow"
    return Decision(action, facts.host, reasons, facts)


class PrePaymentGuard:
    """Decides on x402 payments using BotsRated's free preflight (and, opt-in, a paid check).

    Args:
        client: A ``BotsRatedClient``; a free-only client is created if omitted.
        policy: What to block or warn on.
        fail_open: Allow the payment when BotsRated is unreachable. Default True.
        paid_check_at_or_above_usd: Run a check for payments at or above this: free within the daily quota
            (25 per UTC day), then a $0.001 paid check with a paid-enabled client (skipped otherwise).
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

    def _open_or_closed(self, code: str, detail: str, host: str | None = None) -> Decision:
        eff: Effect = "info" if self.fail_open else "block"
        return Decision("allow" if self.fail_open else "block", host, [Reason(code, detail, eff)])

    def decide(self, resource_url: str | None, requirements: Any, *, request_url: str | None = None) -> Decision:
        """Decide on one payment. Never raises when ``fail_open`` is True.

        Args:
            resource_url: The URL the payment is for. In an x402 hook this is the seller-supplied 402
                ``resource.url``, so on its own it is only a claim.
            requirements: The payment option about to be signed.
            request_url: The URL actually being requested and paid. When given, BotsRated looks up this
                URL's host, and the payment is blocked (even with ``fail_open``) if ``resource_url`` names
                a different host. Hosts are compared after IDNA/trailing-dot normalization, and an apex <-> www
                difference (a redirect between the two) is tolerated. Only host names are sent to BotsRated.
        """
        try:
            return self._decide(resource_url, requirements, request_url)
        except Exception:  # noqa: BLE001
            return self._open_or_closed("hook_error", "the pre-payment check could not evaluate this payment.")

    def _decide(self, resource_url: str | None, requirements: Any, request_url: str | None) -> Decision:
        req = as_requirements(requirements)
        if request_url:
            paid_host = try_host_of(request_url)
            if not paid_host:
                return Decision("block", None, [Reason("invalid_request_url", "the URL being paid has no valid host.", "block")])
            if resource_url:
                claimed = try_host_of(resource_url)
                # An apex <-> www redirect is tolerated: the 402 then comes from the redirected host.
                if claimed is None or not same_site_host(claimed, paid_host):
                    detail = (
                        f"the 402's resource.url names {claimed}, not {paid_host}, the host being paid."
                        if claimed
                        else f"the 402's resource.url has no valid host; the host being paid is {paid_host}."
                    )
                    return Decision("block", paid_host, [Reason("resource_url_mismatch", detail, "block")])
            resource_url = request_url
        if not resource_url:
            return self._open_or_closed("no_resource_url", "the payment has no resource URL to look up.")
        host = try_host_of(resource_url)
        if not host:
            return self._open_or_closed("invalid_resource_url", "the 402's resource.url has no valid host.")
        if host == self.client.host:
            ok = self.client.is_reserved_payment(req)
            reasons = [] if ok else [Reason("botsrated_payment_not_reserved", "payments to BotsRated must go through BotsRatedClient with a budget.", "block")]
            return Decision("allow" if ok else "block", host, reasons)
        try:
            # Host name only: the path and query of resource_url never leave this process.
            pre = self.client.preflight(host)
        except BotsRatedError:
            return self._open_or_closed("botsrated_unreachable", "BotsRated's preflight could not be reached in time.", host)
        facts = facts_from(pre.body, host, "preflight")
        extra: list[Reason] = []
        if (
            pre.found
            and self.paid_threshold is not None
            and is_atomic_amount(str(req.get("amount", "")))
            and int(req["amount"]) >= usd_to_atomic(self.paid_threshold)
        ):
            try:
                facts = facts_from(self.client.check(host), host, "check")
            except BotsRatedError as e:
                extra.append(Reason("paid_check_skipped", clean_text(e), "info"))
        d = evaluate_payment(facts, req, resource_url, self.policy)
        d.reasons.extend(extra)
        return d

    def x402_hook(self, context: Any) -> Any:
        """Hook for ``x402Client(Sync).on_before_payment_creation``. Returns ``AbortResult`` to block.

        The request URL comes from :func:`paying_request` (or :meth:`wrap_get`). Without it the host is read
        from the seller-supplied 402 ``resource.url`` (blocked instead with ``GuardPolicy(require_request_url=True)``).
        """
        return self._hook(context, current_request_url())

    def x402_hook_for(self, request_url: str) -> Callable[[Any], Any]:
        """A hook bound to one request URL, for an x402 client used for a single request."""
        return lambda context: self._hook(context, request_url)

    def wrap_get(self, get: Callable[..., T]) -> Callable[..., T]:
        """Wrap a paying GET (e.g. ``x402_requests(client).get``) so :meth:`x402_hook` knows the URL being paid."""

        def guarded_get(url: Any, *args: Any, **kwargs: Any) -> T:
            with paying_request(str(url)):
                return get(url, *args, **kwargs)

        return guarded_get

    def wrap_async_get(self, get: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        """Async version of :meth:`wrap_get`, e.g. for an x402 ``httpx.AsyncClient``'s ``get``."""

        async def guarded_get(url: Any, *args: Any, **kwargs: Any) -> T:
            with paying_request(str(url)):
                return await get(url, *args, **kwargs)

        return guarded_get

    def _hook_decision(self, context: Any, request_url: str | None) -> Decision:
        pr = context.payment_required
        resource = getattr(pr, "resource", None)
        url = getattr(resource, "url", None) if resource is not None else None
        url = url if isinstance(url, str) else None
        if not request_url and self.policy.require_request_url:
            d = Decision("block", None, [Reason("no_request_url", "the URL being paid is unknown; wrap the request with paying_request(url).", "block")])
        else:
            d = self.decide(url, context.selected_requirements, request_url=request_url)
        paid_url = request_url or url
        if paid_url and d.action == "allow" and try_host_of(paid_url) == self.client.host:
            # A BotsRated payment is a one-shot EIP-3009 transfer: refuse payment extensions (e.g. an
            # ERC-20 approval of Permit2) and never hand any extensions to the signer. Only BotsRated's own quote.
            if not extensions_ok(getattr(pr, "extensions", None)):
                d = Decision("block", d.host, [Reason("botsrated_payment_extensions", "BotsRated quotes must not carry payment extensions.", "block")])
            else:
                pr.extensions = None
        return d

    def _hook(self, context: Any, request_url: str | None) -> Any:
        try:
            d = self._hook_decision(context, request_url)
        except Exception:  # noqa: BLE001
            d = self._open_or_closed("hook_error", "the pre-payment check could not evaluate this payment.")
        if self.on_decision:
            try:
                self.on_decision(d)
            except Exception:  # noqa: BLE001, S110 - caller callback errors are ignored
                pass
        if d.action == "block":
            from x402 import AbortResult  # optional dependency: botsrated[x402]

            return AbortResult(reason=d.summary())
        return None
