"""BotsRated payment guard for x402 clients (Python).

What it does, and nothing more:

- Before your agent signs: looks up facts BotsRated measured about the seller's HOST (only the host name is sent to
  botsrated.com) and compares them locally with the payment request. Advice-only by default: it reports facts and
  stops a payment only when you choose a blocking policy (e.g. ``POLICIES["strict"]``).
- While the payload is built: adds a random x402 ``payment-identifier`` retry key, only when the seller advertises
  that extension, through x402's extension mechanism.
- After: records the payment locally (never the signature) and offers a read-only on-chain check of whether it
  settled once (see :mod:`botsrated.onchain`).

Structural limits (enforced by tests in tests/test_c1_no_repay.py):

- Every hook goes through an adapter that discards what the hook body returns. Observe-only hooks always return
  None; the pre-payment hook returns None or an x402 ``AbortResult``.
- The payment-creation-failure hook is never registered. This module never imports a signer, never builds or sends
  a payment header, and never asks a client to create a payment payload.
- The seller's 402 and the x402 contexts are treated as read-only.
"""

from __future__ import annotations

import json
import secrets
import threading
import time
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Literal, TypeVar

import httpx

from botsrated.onchain import (
    PaymentRecord,
    PaymentState,
    acheck_payment_state,
    check_payment_state,
)
from botsrated.util import (
    BOTSRATED_BASE_URL,
    DISPUTE_URL,
    USER_AGENT,
    clean_text,
    host_and_path,
    is_address,
    is_atomic_amount,
    is_bytes32,
    is_tx_hash,
    same_site_host,
    try_host_of,
)

T = TypeVar("T")
RuleEffect = Literal["allow", "warn", "block"]
Effect = Literal["info", "warn", "block"]
MEASUREMENT_NOTE = "This is a measurement, not a finding about the seller."


@dataclass(frozen=True)
class PaymentGuardPolicy:
    """Which facts warn and which stop a payment. Every rule defaults to advice only."""

    pay_to_mismatch: RuleEffect = "warn"  # payTo not among the payTos BotsRated's probes recorded
    pay_to_invalid: RuleEffect = "warn"  # payTo not a 20-byte hex address
    price_above_observed: RuleEffect = "warn"  # same route, amount above the last one recorded
    resource_host_mismatch: RuleEffect = "warn"  # 402 resource.url names another host (checked locally)
    not_covered: RuleEffect = "allow"  # reported as info
    stale: RuleEffect = "allow"  # reported as info


POLICIES: dict[str, PaymentGuardPolicy] = {
    # Advice only: never stops a payment. The default.
    "warn": PaymentGuardPolicy(),
    # Stops a payment when the payTo was not recorded by BotsRated's probes, is not an address, or the 402 names another host.
    "strict": PaymentGuardPolicy(pay_to_mismatch="block", pay_to_invalid="block", resource_host_mismatch="block"),
}

_RULE_NAMES = {
    "pay_to_mismatch": "payToMismatch",
    "pay_to_invalid": "payToInvalid",
    "price_above_observed": "priceAboveObserved",
    "resource_host_mismatch": "resourceHostMismatch",
    "not_covered": "notCovered",
    "stale": "stale",
}


@dataclass
class GuardReason:
    code: str
    effect: Effect
    fact: str
    rule: str | None = None


@dataclass
class GuardFacts:
    covered: bool
    host: str
    known_pay_tos: list[str] = field(default_factory=list)
    listing_pay_to: str | None = None
    observed_network: str | None = None
    observed_amount: str | None = None
    stale: bool = False
    receipt_url: str | None = None
    probed: tuple[str, str] | None = field(default=None, repr=False)


@dataclass
class GuardDecision:
    phase: Literal["before_payment", "payment_response"]
    action: Literal["allow", "block"]
    would_block: bool
    dry_run: bool
    reasons: list[GuardReason]
    message: str
    host: str | None = None
    policy_rule: str | None = None
    facts: GuardFacts | None = None
    dispute_url: str = DISPUTE_URL


def _effect(e: RuleEffect, fallback: Effect) -> Effect:
    return "block" if e == "block" else "warn" if e == "warn" else "info" if e == "allow" else fallback


def guard_facts_from(body: Any, host: str) -> GuardFacts:
    """Facts read from a preflight body, sanitized: addresses validated, text capped, botsrated.com receipt URLs only."""
    b = body if isinstance(body, dict) else {}
    probe = b.get("latest_probe") if isinstance(b.get("latest_probe"), dict) else ((b.get("receipts") or [{}])[0] if isinstance(b.get("receipts"), list) else {})
    probe = probe if isinstance(probe, dict) else {}
    measured = b.get("measured") if isinstance(b.get("measured"), dict) else {}
    listing = b.get("listing") if isinstance(b.get("listing"), dict) else {}
    pay_tos = sorted({p.lower() for p in (probe.get("live_payTo"), measured.get("last_quoted_payTo")) if is_address(p)})
    receipt = probe.get("receipt_url") if isinstance(probe.get("receipt_url"), str) else None
    rhost = try_host_of(receipt) if receipt else None
    amount = probe.get("live_amount") or measured.get("last_quoted_amount_atomic")
    network = probe.get("live_network") or listing.get("network")
    rp = b.get("route_probed") if isinstance(b.get("route_probed"), dict) else {}
    route = probe.get("url") or rp.get("url")
    freshness = b.get("freshness") if isinstance(b.get("freshness"), dict) else {}
    return GuardFacts(
        covered=b.get("found") is not False,
        host=host,
        known_pay_tos=pay_tos,
        listing_pay_to=listing["payTo"].lower() if is_address(listing.get("payTo")) else None,
        observed_network=clean_text(network, 40) if isinstance(network, str) else None,
        observed_amount=amount if is_atomic_amount(amount) else None,
        stale=freshness.get("stale") is True,
        receipt_url=clean_text(receipt, 200) if receipt and rhost and same_site_host(rhost, "botsrated.com") and receipt.startswith("https://") else None,
        probed=host_and_path(route),
    )


def _get(obj: Any, *names: str) -> Any:
    """Read a field from a dict or a pydantic model (camelCase or snake_case)."""
    for n in names:
        if isinstance(obj, dict) and n in obj:
            return obj[n]
        if not isinstance(obj, dict) and obj is not None and hasattr(obj, n):
            return getattr(obj, n)
    return None


def evaluate_facts(facts: GuardFacts, req: Any, paid_url: str | None, policy: PaymentGuardPolicy) -> list[GuardReason]:
    """Pure, local comparison of one payment option with BotsRated facts."""
    out: list[GuardReason] = []
    network = clean_text(_get(req, "network"), 40) if isinstance(_get(req, "network"), str) else ""
    raw_pay_to = _get(req, "payTo", "pay_to")
    pay_to = raw_pay_to.lower() if is_address(raw_pay_to) else None
    amount = _get(req, "amount")
    if not facts.covered:
        out.append(GuardReason("not_covered", _effect(policy.not_covered, "info"), f"BotsRated has no probe record for {facts.host}.", "notCovered"))
        return out
    if pay_to:
        if facts.observed_network and network and facts.observed_network != network:
            out.append(GuardReason("network_not_observed", "info", f"BotsRated's probes recorded {facts.host} on {facts.observed_network}, not on {network}."))
        elif facts.known_pay_tos and pay_to not in facts.known_pay_tos:
            on = facts.observed_network or network or "this network"
            out.append(
                GuardReason(
                    "payto_not_observed",
                    _effect(policy.pay_to_mismatch, "warn"),
                    f"the payTo in this payment request is not among the payTo addresses BotsRated's probes recorded for {facts.host} on {on}.",
                    "payToMismatch",
                )
            )
        elif not facts.known_pay_tos and facts.listing_pay_to:
            if pay_to == facts.listing_pay_to:
                out.append(GuardReason("payto_listing_only", "info", f"the payTo matches {facts.host}'s directory listing; BotsRated's probes have not recorded a payTo for {facts.host} yet."))
            else:
                out.append(
                    GuardReason(
                        "payto_not_observed",
                        _effect(policy.pay_to_mismatch, "warn"),
                        f"the payTo in this payment request differs from the payTo in {facts.host}'s directory listing; BotsRated's probes have not recorded a payTo for {facts.host} yet.",
                        "payToMismatch",
                    )
                )
    paid = host_and_path(paid_url)
    if facts.observed_amount and isinstance(amount, str) and is_atomic_amount(amount) and facts.probed and paid and facts.probed == paid and int(amount) > int(facts.observed_amount):
        out.append(
            GuardReason(
                "price_above_observed",
                _effect(policy.price_above_observed, "warn"),
                f"the quoted amount ({amount} atomic units) is above the last amount BotsRated recorded on this route ({facts.observed_amount}).",
                "priceAboveObserved",
            )
        )
    if facts.stale:
        out.append(GuardReason("data_stale", _effect(policy.stale, "info"), f"BotsRated's latest probe of {facts.host} is older than 24 hours.", "stale"))
    return out


def _summarize(d: GuardDecision) -> str:
    stopping = next((r for r in d.reasons if r.effect == "block"), None)
    host_part = f" for {d.host}" if d.host else ""
    if stopping:
        lead = f"Dry run: your payment policy would stop this payment{host_part}" if d.dry_run else "Payment stopped by your payment policy"
        receipt = f" Receipt: {d.facts.receipt_url}." if d.facts and d.facts.receipt_url else ""
        return f"{lead} (rule: {stopping.rule or stopping.code}). Fact: {stopping.fact}{receipt} {MEASUREMENT_NOTE} Dispute: {d.dispute_url}"
    notes = [r for r in d.reasons if r.effect == "warn"]
    if notes:
        return f"Payment guard note{host_part}: " + " ".join(f"{r.code}: {r.fact}" for r in notes) + f" {MEASUREMENT_NOTE} Dispute: {d.dispute_url}"
    return f"Payment guard: no policy rule matched{host_part}."


# ----------------------------------------------------------------------------------------------------------------
# C1 adapters: the value a hook body returns is discarded.


def observe_only(body: Callable[[Any], Any]) -> Callable[[Any], None]:
    """Observe-only adapter: runs ``body``, swallows errors, and always returns None."""

    def hook(ctx: Any) -> None:
        try:
            body(ctx)
        except Exception:  # noqa: BLE001, S110 - observe-only: never affects the payment flow
            pass

    return hook


def observe_only_async(body: Callable[[Any], Awaitable[Any]]) -> Callable[[Any], Awaitable[None]]:
    async def hook(ctx: Any) -> None:
        try:
            await body(ctx)
        except Exception:  # noqa: BLE001, S110 - observe-only: never affects the payment flow
            pass

    return hook


def _abort(reason: str) -> Any:
    from x402 import AbortResult  # optional dependency: botsrated[x402]

    return AbortResult(reason=clean_text(reason or "Payment stopped by your payment policy.", 700))


def abort_only(body: Callable[[Any], tuple[bool, str]]) -> Callable[[Any], Any]:
    """Pre-payment adapter: returns None or an x402 ``AbortResult``. Nothing else."""

    def hook(ctx: Any) -> Any:
        try:
            stop, reason = body(ctx)
        except Exception:  # noqa: BLE001
            return None
        return _abort(reason) if stop is True else None

    return hook


def abort_only_async(body: Callable[[Any], Awaitable[tuple[bool, str]]]) -> Callable[[Any], Awaitable[Any]]:
    async def hook(ctx: Any) -> Any:
        try:
            stop, reason = await body(ctx)
        except Exception:  # noqa: BLE001
            return None
        return _abort(reason) if stop is True else None

    return hook


# ----------------------------------------------------------------------------------------------------------------
# Per-request context: the URL being paid and the caller's operation key.

_REQUEST_URL: ContextVar[str | None] = ContextVar("botsrated_guard_request_url", default=None)
_OPERATION: ContextVar[str | None] = ContextVar("botsrated_guard_operation", default=None)


def _now() -> int:
    return int(time.time())


def _iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


class _RetryKeyExtension:
    """x402 client extension that adds a ``payment-identifier`` id only when the seller advertises it."""

    key = "payment-identifier"
    hooks = None
    transport_hooks = None

    def __init__(self, guard: PaymentGuard) -> None:
        self._guard = guard

    def enrich_payment_payload(self, payment_payload: Any, payment_required: Any) -> Any:
        try:
            return self._guard._enrich(payment_payload, payment_required)
        except Exception:  # noqa: BLE001
            return payment_payload


class PaymentGuard:
    """Payment guard. Zero-config: advice only, hosted host-name lookup, fail-open, retry key where advertised.

    Args:
        policy: Which facts warn or stop a payment. Default ``POLICIES["warn"]`` (advice only).
        dry_run: Log decisions and change nothing (no payment stopped, no retry key added). Recommended first setting.
        hosted: Call BotsRated's free hosted preflight. With False nothing is sent to botsrated.com.
        fail_open: When BotsRated can't be reached (or the guard errors): True allows (default), False stops.
        retry_key: Add a ``payment-identifier`` id where the seller advertises it. Default True.
        onchain: Keyword arguments for :func:`botsrated.onchain.check_payment_state` (``rpcs``, ``transport``...), or False.
        base_url, timeout, cache_ttl: Hosted lookup settings (defaults: botsrated.com, 1.5 s, 300 s).
        http / async_http: Optional ``httpx.Client`` / ``httpx.AsyncClient`` for the hosted lookup.
        preflight: Replace the hosted lookup: ``(host) -> (found, body)``. Receives a host name only.
        on_decision: Receives every decision. Errors raised in it are ignored.
    """

    def __init__(
        self,
        *,
        policy: PaymentGuardPolicy | None = None,
        dry_run: bool = False,
        hosted: bool = True,
        fail_open: bool = True,
        retry_key: bool = True,
        onchain: dict[str, Any] | Literal[False] | None = None,
        base_url: str = BOTSRATED_BASE_URL,
        timeout: float = 1.5,
        cache_ttl: float = 300.0,
        http: httpx.Client | None = None,
        async_http: httpx.AsyncClient | None = None,
        preflight: Callable[[str], tuple[bool, dict[str, Any]]] | None = None,
        on_decision: Callable[[GuardDecision], None] | None = None,
    ) -> None:
        self.policy = policy or POLICIES["warn"]
        self.dry_run = dry_run
        self.hosted = hosted
        self.fail_open = fail_open
        self.retry_key = retry_key and not dry_run
        self.onchain = onchain
        self.base_url = base_url.rstrip("/")
        self._own_host = try_host_of(self.base_url) or "botsrated.com"
        self._timeout = timeout
        self._cache_ttl = cache_ttl
        self._cache: dict[str, tuple[float, tuple[bool, dict[str, Any]]]] = {}
        self._http = http
        self._async_http = async_http
        self._preflight = preflight
        self.on_decision = on_decision
        self._records: dict[str, PaymentRecord] = {}
        self._retry_keys: dict[str, tuple[str, int]] = {}
        self._lock = threading.Lock()
        self.extension = _RetryKeyExtension(self)
        # Hook adapters (C1): return values of the bodies are discarded.
        self.before_payment_creation = abort_only(self._before_sync)
        self.after_payment_creation = observe_only(self._after)
        self.payment_response = observe_only(self._response)
        self.abefore_payment_creation = abort_only_async(self._before_async)
        self.aafter_payment_creation = observe_only_async(self._aafter)
        self.apayment_response = observe_only_async(self._aresponse)

    # -- registration -------------------------------------------------------------------------------------------

    def install(self, client: Any, *, asynchronous: bool | None = None) -> Any:
        """Register the hooks (and the retry-key extension unless dry-run or ``retry_key=False``) on an x402 client.

        Works with ``x402ClientSync`` (sync hooks) and ``x402Client`` (async hooks; detected by class name, or pass
        ``asynchronous``). Never registers a failure hook.
        """
        is_async = asynchronous if asynchronous is not None else not type(client).__name__.endswith("Sync")
        if is_async:
            client.on_before_payment_creation(self.abefore_payment_creation)
            client.on_after_payment_creation(self.aafter_payment_creation)
            client.on_payment_response(self.apayment_response)
        else:
            client.on_before_payment_creation(self.before_payment_creation)
            client.on_after_payment_creation(self.after_payment_creation)
            client.on_payment_response(self.payment_response)
        if self.retry_key:
            client.register_extension(self.extension)
        return client

    @contextmanager
    def request(self, url: str) -> Iterator[None]:
        """Tell the guard which URL the x402 request inside this block is paying."""
        token = _REQUEST_URL.set(str(url))
        try:
            yield
        finally:
            _REQUEST_URL.reset(token)

    @contextmanager
    def operation(self, operation_key: str) -> Iterator[None]:
        """One logical operation: a retried payment inside it (same payTo, host and path) reuses its retry key."""
        token = _OPERATION.set(str(operation_key))
        try:
            yield
        finally:
            _OPERATION.reset(token)

    def wrap_get(self, get: Callable[..., T]) -> Callable[..., T]:
        """Wrap a paying GET (e.g. an x402 ``requests`` session's ``get``) so the guard knows the URL being paid."""

        def guarded(url: Any, *args: Any, **kwargs: Any) -> T:
            with self.request(str(url)):
                return get(url, *args, **kwargs)

        return guarded

    def wrap_async_get(self, get: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        async def guarded(url: Any, *args: Any, **kwargs: Any) -> T:
            with self.request(str(url)):
                return await get(url, *args, **kwargs)

        return guarded

    # -- decisions ----------------------------------------------------------------------------------------------

    def _emit(self, d: GuardDecision) -> None:
        if self.on_decision is None:
            return
        try:
            self.on_decision(d)
        except Exception:  # noqa: BLE001, S110 - caller callback errors are ignored
            pass

    def _finish(self, phase: Literal["before_payment", "payment_response"], reasons: list[GuardReason], host: str | None, facts: GuardFacts | None = None) -> GuardDecision:
        stopping = next((r for r in reasons if r.effect == "block"), None)
        d = GuardDecision(
            phase=phase,
            action="block" if stopping and not self.dry_run else "allow",
            would_block=stopping is not None,
            dry_run=self.dry_run,
            reasons=reasons,
            message="",
            host=host,
            policy_rule=(stopping.rule or stopping.code) if stopping else None,
            facts=facts,
        )
        d.message = _summarize(d)
        return d

    def _local(self, ctx: Any) -> tuple[list[GuardReason], str | None, str | None, Any, str | None]:
        pr = _get(ctx, "payment_required", "paymentRequired")
        req = _get(ctx, "selected_requirements", "selectedRequirements")
        reasons: list[GuardReason] = []
        request_url = _REQUEST_URL.get()
        request_host = try_host_of(request_url)
        resource = _get(pr, "resource")
        resource_url = _get(resource, "url")
        resource_url = resource_url if isinstance(resource_url, str) else (None if resource_url is None else "")
        claimed = host_and_path(resource_url)[0] if host_and_path(resource_url) else None
        host = request_host or claimed
        p = self.policy
        if request_host and resource_url is not None and (not claimed or not same_site_host(claimed, request_host)):
            fact = (
                f"the 402's resource.url names {claimed}, not {request_host}, the host being paid."
                if claimed
                else f"the 402's resource.url is not an http(s) URL; the host being paid is {request_host}."
            )
            reasons.append(GuardReason("resource_host_mismatch", _effect(p.resource_host_mismatch, "warn"), fact, "resourceHostMismatch"))
        if not is_address(_get(req, "payTo", "pay_to")):
            reasons.append(GuardReason("payto_invalid", _effect(p.pay_to_invalid, "warn"), "the payment request's payTo is not a 20-byte hex address.", "payToInvalid"))
        t = _get(req, "maxTimeoutSeconds", "max_timeout_seconds")
        if t is None:
            reasons.append(GuardReason("max_timeout_missing", "info", "the payment request has no maxTimeoutSeconds."))
        elif type(t) is not int or not 0 < t <= 600:
            reasons.append(GuardReason("max_timeout_above_600", "info", "the payment request's maxTimeoutSeconds is not an integer from 1 to 600."))
        lookup: str | None = None
        if not host:
            reasons.append(GuardReason("no_host", "info", "the payment request names no http(s) host to look up."))
        elif same_site_host(host, self._own_host):
            reasons.append(GuardReason("botsrated_payment", "info", "this is a payment to BotsRated; use PrePaymentGuard with BotsRatedClient for those."))
        elif not self.hosted:
            reasons.append(GuardReason("hosted_off", "info", "hosted checks are off (hosted=False); only local checks ran."))
        else:
            lookup = host
        return reasons, host, lookup, req, request_url or resource_url

    def _with_facts(self, reasons: list[GuardReason], host: str, found_body: tuple[bool, dict[str, Any]] | None, req: Any, paid_url: str | None) -> GuardFacts | None:
        if found_body is None:
            reasons.append(GuardReason("botsrated_unreachable", "info" if self.fail_open else "block", "BotsRated's preflight could not be reached in time.", "failOpen"))
            return None
        found, body = found_body
        facts = guard_facts_from(body, host)
        if not found:
            facts.covered = False
        reasons.extend(evaluate_facts(facts, req, paid_url, self.policy))
        return facts

    def _hook_error(self) -> GuardDecision:
        return self._finish("before_payment", [GuardReason("hook_error", "info" if self.fail_open else "block", "the payment guard could not evaluate this payment.", "failOpen")], None)

    def _cached(self, host: str) -> tuple[bool, dict[str, Any]] | None:
        hit = self._cache.get(host)
        if hit and time.monotonic() - hit[0] < self._cache_ttl:
            return hit[1]
        return None

    def _store(self, host: str, value: tuple[bool, dict[str, Any]]) -> tuple[bool, dict[str, Any]]:
        if self._cache_ttl > 0:
            self._cache[host] = (time.monotonic(), value)
        return value

    def _parse(self, resp: httpx.Response) -> tuple[bool, dict[str, Any]]:
        if len(resp.content) > 1_000_000:
            body: Any = {}
        else:
            try:
                body = resp.json()
            except ValueError:
                body = {}
        body = body if isinstance(body, dict) else {}
        err = body.get("error") if isinstance(body.get("error"), dict) else {}
        if resp.status_code == 404 and err.get("code") == "host_not_covered":
            return (False, {"found": False})
        if resp.status_code >= 400:
            raise RuntimeError(f"HTTP {resp.status_code}")
        return (body.get("found") is not False, body)

    def _url_for(self, host: str) -> tuple[str, dict[str, str], dict[str, str]]:
        # Host name only: never the path, query, wallet, amount, tx hash or payment header.
        return f"{self.base_url}/v1/preflight", {"url": host}, {"accept": "application/json", "user-agent": USER_AGENT}

    def _lookup_sync(self, host: str) -> tuple[bool, dict[str, Any]] | None:
        try:
            hit = self._cached(host)
            if hit is not None:
                return hit
            if self._preflight is not None:
                return self._store(host, self._preflight(host))
            url, params, headers = self._url_for(host)
            if self._http is not None:
                resp = self._http.get(url, params=params, headers=headers, timeout=self._timeout, follow_redirects=False)
            else:
                with httpx.Client(timeout=self._timeout, follow_redirects=False) as c:
                    resp = c.get(url, params=params, headers=headers)
            return self._store(host, self._parse(resp))
        except Exception:  # noqa: BLE001
            return None

    async def _lookup_async(self, host: str) -> tuple[bool, dict[str, Any]] | None:
        try:
            hit = self._cached(host)
            if hit is not None:
                return hit
            if self._preflight is not None:
                return self._store(host, self._preflight(host))
            url, params, headers = self._url_for(host)
            if self._async_http is not None:
                resp = await self._async_http.get(url, params=params, headers=headers, timeout=self._timeout, follow_redirects=False)
            else:
                async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=False) as c:
                    resp = await c.get(url, params=params, headers=headers)
            return self._store(host, self._parse(resp))
        except Exception:  # noqa: BLE001
            return None

    def decide(self, ctx: Any) -> GuardDecision:
        """Sync decision for one x402 ``PaymentCreationContext`` (or a dict with the same fields). Never raises."""
        try:
            reasons, host, lookup, req, paid_url = self._local(ctx)
            facts = self._with_facts(reasons, lookup, self._lookup_sync(lookup), req, paid_url) if lookup else None
            return self._finish("before_payment", reasons, host, facts)
        except Exception:  # noqa: BLE001
            return self._hook_error()

    async def adecide(self, ctx: Any) -> GuardDecision:
        """Async :meth:`decide` (uses ``httpx.AsyncClient``; never blocks the event loop on the lookup)."""
        try:
            reasons, host, lookup, req, paid_url = self._local(ctx)
            facts = self._with_facts(reasons, lookup, await self._lookup_async(lookup), req, paid_url) if lookup else None
            return self._finish("before_payment", reasons, host, facts)
        except Exception:  # noqa: BLE001
            return self._hook_error()

    def _before_sync(self, ctx: Any) -> tuple[bool, str]:
        d = self.decide(ctx)
        self._emit(d)
        return d.action == "block", d.message

    async def _before_async(self, ctx: Any) -> tuple[bool, str]:
        d = await self.adecide(ctx)
        self._emit(d)
        return d.action == "block", d.message

    # -- after payment ------------------------------------------------------------------------------------------

    def _record_from(self, ctx: Any) -> PaymentRecord | None:
        payload = _get(ctx, "payment_payload", "paymentPayload")
        inner = _get(payload, "payload")
        auth = _get(inner, "authorization")
        accepted = _get(payload, "accepted") or _get(ctx, "requirements", "selected_requirements")
        if not isinstance(auth, dict) or accepted is None:
            return None
        frm, nonce = auth.get("from"), auth.get("nonce")
        pay_to = _get(accepted, "payTo", "pay_to")
        amount = _get(accepted, "amount")
        try:
            valid_before = int(str(auth.get("validBefore")))
        except (TypeError, ValueError):
            return None
        if not (is_address(frm) and is_address(pay_to) and is_bytes32(nonce) and is_atomic_amount(str(amount))):
            return None
        try:
            valid_after: int | None = int(str(auth.get("validAfter")))
        except (TypeError, ValueError):
            valid_after = None
        pr = _get(ctx, "payment_required", "paymentRequired")
        res_url = _get(_get(pr, "resource"), "url") or _get(_get(payload, "resource"), "url")
        hp = host_and_path(res_url)
        host = try_host_of(_REQUEST_URL.get()) or (hp[0] if hp else None)
        asset = _get(accepted, "asset")
        return PaymentRecord(
            network=clean_text(_get(accepted, "network"), 40),
            asset=asset if is_address(asset) else "",
            from_=frm.lower(),
            pay_to=pay_to.lower(),
            amount=str(amount),
            nonce=nonce.lower(),
            valid_before=valid_before,
            valid_after=valid_after,
            host=host,
            created_at=_now(),
        )

    def _prune(self) -> None:
        now = _now()
        with self._lock:
            for k in [k for k, r in self._records.items() if r.valid_before + 3600 < now]:
                del self._records[k]
            for k in [k for k, v in self._retry_keys.items() if v[1] < now]:
                del self._retry_keys[k]

    def _after(self, ctx: Any) -> None:
        self._prune()
        rec = self._record_from(ctx)
        if rec is not None:
            with self._lock:
                self._records[f"{rec.pay_to}:{rec.nonce}"] = rec

    async def _aafter(self, ctx: Any) -> None:
        self._after(ctx)

    def _response(self, ctx: Any) -> None:
        payload = _get(ctx, "payment_payload", "paymentPayload")
        auth = _get(_get(payload, "payload"), "authorization")
        pay_to = _get(_get(payload, "accepted") or _get(ctx, "requirements"), "payTo", "pay_to")
        if not isinstance(auth, dict) or not is_bytes32(auth.get("nonce")) or not is_address(pay_to):
            return
        key = f"{pay_to.lower()}:{auth['nonce'].lower()}"
        with self._lock:
            rec = self._records.get(key)
        rec = rec or self._record_from(ctx)
        if rec is None:
            return
        settle = _get(ctx, "settle_response", "settleResponse")
        tx = _get(settle, "transaction")
        if is_tx_hash(tx):
            rec = replace(rec, tx_hash_hint=tx.lower())
        with self._lock:
            self._records[key] = rec
        if _get(settle, "success") is True:
            return
        wait_until = rec.valid_before + 60
        self._emit(
            self._finish(
                "payment_response",
                [
                    GuardReason(
                        "payment_state_unknown",
                        "warn",
                        f"the seller's response did not report a settled payment. The signed authorization stays valid until {_iso(rec.valid_before)}. "
                        f"Do not sign a new payment for this purchase before {_iso(wait_until)}; call guard.payment_state() for an on-chain answer.",
                    )
                ],
                rec.host,
            )
        )

    async def _aresponse(self, ctx: Any) -> None:
        self._response(ctx)

    def records(self) -> list[PaymentRecord]:
        """Payments seen being created (oldest first). No signatures."""
        self._prune()
        with self._lock:
            return [replace(r) for r in self._records.values()]

    def _find(self, ref: PaymentRecord | dict[str, str]) -> PaymentRecord | None:
        if isinstance(ref, PaymentRecord):
            return ref
        with self._lock:
            return self._records.get(f"{str(ref.get('pay_to') or ref.get('payTo')).lower()}:{str(ref.get('nonce')).lower()}")

    def _no_check(self, rec: PaymentRecord | None) -> PaymentState:
        vb = rec.valid_before if rec else _now()
        return PaymentState(
            "unknown",
            [],
            code="payment_state_unknown",
            reason="onchain_disabled" if self.onchain is False else "no_record",
            wait_until=vb + 60,
            message="Payment state unknown. Do not sign a new payment for this purchase until you can confirm it.",
        )

    def payment_state(self, ref: PaymentRecord | dict[str, str]) -> PaymentState:
        """Read-only on-chain state: "settled", "unknown" (wait) or "expired_unsettled". Never pays or retries."""
        rec = self._find(ref)
        if self.onchain is False or rec is None:
            return self._no_check(rec)
        return check_payment_state(rec, **(self.onchain or {}))

    async def apayment_state(self, ref: PaymentRecord | dict[str, str]) -> PaymentState:
        rec = self._find(ref)
        if self.onchain is False or rec is None:
            return self._no_check(rec)
        return await acheck_payment_state(rec, **(self.onchain or {}))

    # -- retry key ----------------------------------------------------------------------------------------------

    def _enrich(self, payload: Any, payment_required: Any) -> Any:
        if not self.retry_key or _get(payload, "x402_version", "x402Version") != 2:
            return payload
        decl = (_get(payment_required, "extensions") or {}).get("payment-identifier") if isinstance(_get(payment_required, "extensions"), dict) else None
        if not isinstance(decl, dict):
            return payload  # the seller did not advertise it
        extensions = _get(payload, "extensions")
        existing = extensions.get("payment-identifier") if isinstance(extensions, dict) else None
        if isinstance(existing, dict) and isinstance(existing.get("info"), dict) and "id" in existing["info"]:
            return payload  # someone already set one
        pay_to = _get(_get(payload, "accepted"), "payTo", "pay_to")
        route = host_and_path(_REQUEST_URL.get()) or host_and_path(_get(_get(payment_required, "resource"), "url"))
        if not is_address(pay_to) or route is None:
            return payload
        self._prune()
        auth = _get(_get(payload, "payload"), "authorization")
        try:
            vb = int(str(auth.get("validBefore"))) if isinstance(auth, dict) else _now() + 600
        except (TypeError, ValueError):
            vb = _now() + 600
        op = _OPERATION.get()
        new_id = "pay_" + secrets.token_hex(16)
        if op is not None:
            # One id per (operation, payTo, host, path): a retry of the same operation reuses it; nothing crosses sellers.
            k = json.dumps([op, pay_to.lower(), route[0], route[1]])
            with self._lock:
                hit = self._retry_keys.get(k)
                pid = hit[0] if hit else new_id
                self._retry_keys[k] = (pid, max(vb + 600, hit[1] if hit else 0))
        else:
            pid = new_id
        had_key = isinstance(existing, dict)
        base = existing if had_key else decl
        info = base.get("info") if isinstance(base.get("info"), dict) else {}
        new_ext = {**(extensions if isinstance(extensions, dict) else {}), "payment-identifier": {**base, "info": {**info, "id": pid}}}
        out = payload.model_copy(update={"extensions": new_ext}) if hasattr(payload, "model_copy") else {**payload, "extensions": new_ext}
        # Invariant: the result equals the input except extensions["payment-identifier"](.info.id). Otherwise unchanged.
        dump = (lambda x: x.model_dump(by_alias=True, mode="json")) if hasattr(payload, "model_dump") else (lambda x: json.loads(json.dumps(x)))
        check = dump(out)
        if had_key:
            del check["extensions"]["payment-identifier"]["info"]["id"]
        else:
            del check["extensions"]["payment-identifier"]
            if not isinstance(extensions, dict):
                check["extensions"] = extensions
        if json.dumps(check, sort_keys=True) != json.dumps(dump(payload), sort_keys=True):
            return payload
        return out


def decision_as_dict(d: GuardDecision) -> dict[str, Any]:
    """JSON-friendly view of a decision (for logging)."""
    out = asdict(d)
    if out.get("facts"):
        out["facts"].pop("probed", None)
    return out
