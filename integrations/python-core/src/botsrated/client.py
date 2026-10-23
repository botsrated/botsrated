"""HTTP client for BotsRated. Free routes by default; paid routes only with an explicit budget."""

from __future__ import annotations

import base64
import json
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal, Protocol
from urllib.parse import quote, urlencode, urlsplit

import httpx

BOTSRATED_BASE_URL = "https://botsrated.com"
BOTSRATED_PAY_TO = "0x7F936f42F46B6c4Cbd3242cF8A1759dfe829E349"
BASE_MAINNET = "eip155:8453"
BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
# Published prices (since 2026-10-23) in atomic USDC. Quotes above these are refused.
PAID_ROUTE_MAX_ATOMIC: dict[str, int] = {"check": 1000, "report": 2000, "best": 10000}
# Free calls per client (IP) per UTC day. Inside the quota BotsRated answers 200 with charged: false, no 402.
FREE_DAILY_QUOTA: dict[str, int] = {"check": 100, "report": 10, "best": 0}
# Longest payment authorization window accepted for a BotsRated payment.
MAX_TIMEOUT_SECONDS = 600
# EIP-3009 needs only the token's EIP-712 domain name/version. Any other ``extra`` key (e.g.
# assetTransferMethod=permit2, paymentFlow) switches the x402 signer to a different flow.
ALLOWED_EXTRA = frozenset({"name", "version"})
# Discovery metadata only. Payment extensions (erc20ApprovalGasSponsoring, eip2612GasSponsoring, ...)
# can make the signer sign more than the one-shot payment, so a BotsRated quote carrying them is refused.
IGNORED_EXTENSIONS = frozenset({"bazaar"})


def extensions_ok(extensions: Any) -> bool:
    """True when a PaymentRequired.extensions value carries nothing but discovery metadata."""
    return extensions is None or (isinstance(extensions, dict) and set(extensions) <= IGNORED_EXTENSIONS)


def is_free_quota_answer(body: Any) -> bool:
    """True when a 2xx BotsRated body was served from the free daily quota (nothing was charged)."""
    return isinstance(body, dict) and body.get("charged") is False and isinstance(body.get("free_quota"), dict)

PaidRoute = Literal["check", "report", "best"]


class BotsRatedError(Exception):
    def __init__(self, message: str, code: str, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class _ResponseLike(Protocol):
    status_code: int
    headers: Any

    def json(self) -> Any: ...


PayingGet = Callable[[str], _ResponseLike]
"""A GET that pays x402 challenges, e.g. ``x402_requests(x402_client).get`` or a sync httpx x402 client's ``get``."""


def usd_to_atomic(usd: float | str | Decimal) -> int:
    d = Decimal(str(usd))
    if d < 0:
        raise BotsRatedError(f"invalid USD amount: {usd}", "invalid_amount")
    return int((d * 1_000_000).to_integral_value())


def host_of(url_or_host: str) -> str:
    s = url_or_host.strip()
    host = urlsplit(s if "://" in s else f"https://{s}").hostname
    if not host:
        raise BotsRatedError(f"not a URL or host: {url_or_host}", "invalid_host")
    return host.lower()


def _eq(a: str | None, b: str | None) -> bool:
    return bool(a) and bool(b) and a.lower() == b.lower()  # type: ignore[union-attr]


class Budget:
    """Spend tracker in atomic USDC. Thread-safe. Reserve before paying; commit or release after."""

    def __init__(self, limit_atomic: int) -> None:
        if limit_atomic <= 0:
            raise BotsRatedError("budget must be greater than 0", "invalid_budget")
        self.limit_atomic = limit_atomic
        self.spent_atomic = 0
        self.pending_atomic = 0
        self._lock = threading.Lock()

    @property
    def remaining_atomic(self) -> int:
        return self.limit_atomic - self.spent_atomic - self.pending_atomic

    def reserve(self, amount: int) -> None:
        with self._lock:
            if amount > self.remaining_atomic:
                raise BotsRatedError(
                    f"budget exceeded: need {amount / 1e6} USD, {self.remaining_atomic / 1e6} USD left",
                    "budget_exceeded",
                )
            self.pending_atomic += amount

    def commit(self, amount: int) -> None:
        with self._lock:
            self.pending_atomic -= amount
            self.spent_atomic += amount

    def release(self, amount: int) -> None:
        with self._lock:
            self.pending_atomic -= amount


@dataclass
class PreflightResult:
    found: bool
    host: str
    body: dict[str, Any]


def read_payment_required(resp: _ResponseLike) -> dict[str, Any]:
    header = resp.headers.get("payment-required")
    try:
        return json.loads(base64.b64decode(header)) if header else resp.json()
    except Exception as e:  # noqa: BLE001
        raise BotsRatedError("could not parse the 402 payment terms", "bad_402") from e


class BotsRatedClient:
    """BotsRated client.

    Args:
        base_url: Defaults to https://botsrated.com.
        http: Optional ``httpx.Client`` for unpaid requests.
        timeout: Seconds per unpaid request.
        cache_ttl: Preflight cache per host, seconds. 0 disables.
        budget_usd: Total USD allowed for paid routes. Paid routes stay disabled unless this and ``paying_get`` are set.
        paying_get: A GET callable that pays x402 challenges.
        expected_pay_to: BotsRated payTo to accept. Defaults to ``BOTSRATED_PAY_TO``.
    """

    def __init__(
        self,
        base_url: str = BOTSRATED_BASE_URL,
        *,
        http: httpx.Client | None = None,
        timeout: float = 4.0,
        cache_ttl: float = 300.0,
        budget_usd: float | str | None = None,
        paying_get: PayingGet | None = None,
        expected_pay_to: str = BOTSRATED_PAY_TO,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.host = host_of(self.base_url)
        self._http = http or httpx.Client(timeout=timeout, headers={"accept": "application/json"})
        self._cache_ttl = cache_ttl
        self._cache: dict[str, tuple[float, PreflightResult]] = {}
        self._paying_get = paying_get
        self._expected_pay_to = expected_pay_to
        self.budget: Budget | None = None
        self.last_free_quota: dict[str, Any] | None = None
        if (budget_usd is None) != (paying_get is None):
            raise BotsRatedError("paid routes need both budget_usd and paying_get", "invalid_config")
        if budget_usd is not None:
            self.budget = Budget(usd_to_atomic(budget_usd))

    @property
    def paid_enabled(self) -> bool:
        return self.budget is not None

    def _get(self, path: str) -> httpx.Response:
        try:
            return self._http.get(self.base_url + path)
        except httpx.HTTPError as e:
            raise BotsRatedError(f"BotsRated unreachable: {e}", "unreachable") from e

    def preflight(self, url_or_host: str) -> PreflightResult:
        """Free. Latest stored probe for a seller; ``found=False`` when the host is not covered."""
        host = host_of(url_or_host)
        hit = self._cache.get(host)
        if hit and time.monotonic() - hit[0] < self._cache_ttl:
            return hit[1]
        target = url_or_host if "://" in url_or_host else host
        resp = self._get(f"/v1/preflight?url={quote(target, safe='')}")
        try:
            body = resp.json()
        except ValueError:
            body = {}
        err = body.get("error") if isinstance(body, dict) else None
        if resp.status_code == 404 and isinstance(err, dict) and err.get("code") == "host_not_covered":
            result = PreflightResult(False, host, {**body, "found": False})
        elif resp.status_code >= 400:
            msg = err.get("message") if isinstance(err, dict) else None
            code = err.get("code") if isinstance(err, dict) else None
            raise BotsRatedError(msg or f"preflight returned {resp.status_code}", code or "http_error", resp.status_code)
        else:
            result = PreflightResult(body.get("found") is not False, host, body)
        if self._cache_ttl > 0:
            self._cache[host] = (time.monotonic(), result)
        return result

    def check(self, url_or_host: str) -> dict[str, Any]:
        """Paid ($0.001; first 100/day free). Facts, paid test-buys and recent receipts for one host."""
        return self._paid(f"/v1/check?host={quote(host_of(url_or_host), safe='')}", "check")

    def report(self, url_or_host: str) -> dict[str, Any]:
        """Paid ($0.002; first 10/day free). Full receipt history for one host."""
        return self._paid(f"/v1/report/{quote(host_of(url_or_host), safe='')}", "report")

    def best(self, task: str, sort: str | None = None, max_price_usd: float | None = None) -> dict[str, Any]:
        """Paid ($0.01). Top providers for a task."""
        q: dict[str, str] = {"task": task}
        if sort:
            q["sort"] = sort
        if max_price_usd is not None:
            q["max_price"] = str(max_price_usd)
        return self._paid(f"/v1/best?{urlencode(q)}", "best")

    def acceptable_payment(self, req: dict[str, Any], max_atomic: int = PAID_ROUTE_MAX_ATOMIC["best"]) -> bool:
        amount = str(req.get("amount", ""))
        extra = req.get("extra")
        if extra is None:
            extra = {}
        timeout = req.get("maxTimeoutSeconds", req.get("max_timeout_seconds"))
        if timeout is None:
            timeout = MAX_TIMEOUT_SECONDS
        return (
            isinstance(extra, dict)
            and set(extra) <= ALLOWED_EXTRA
            and all(isinstance(v, str) for v in extra.values())
            and type(timeout) is int
            and 0 < timeout <= MAX_TIMEOUT_SECONDS
            and req.get("scheme") == "exact"
            and req.get("network") == BASE_MAINNET
            and _eq(req.get("asset"), BASE_USDC)
            and _eq(req.get("payTo") or req.get("pay_to"), self._expected_pay_to)
            and amount.isdigit()
            and int(amount) <= max_atomic
        )

    def is_reserved_payment(self, req: dict[str, Any]) -> bool:
        """True if ``req`` is an acceptable BotsRated payment this client has reserved budget for."""
        return (
            self.budget is not None
            and self.acceptable_payment(req)
            and self.budget.pending_atomic >= int(req["amount"])
        )

    def _paid(self, path: str, route: PaidRoute) -> dict[str, Any]:
        # Ask unpaid first. Inside the free daily quota this already returns the data (200, charged: false):
        # nothing is paid and the budget is untouched. Bad input gets a free 4xx here, before any payment.
        quote_resp = self._get(path)
        if 200 <= quote_resp.status_code < 300:
            try:
                body = quote_resp.json()
            except ValueError:
                body = None
            if is_free_quota_answer(body):
                self.last_free_quota = body["free_quota"]
                return body
            raise BotsRatedError(
                f"expected 402 or a free-quota answer, got {quote_resp.status_code}", "unexpected_status", quote_resp.status_code
            )
        if self.budget is None or self._paying_get is None:
            msg = "paid BotsRated routes are disabled; pass budget_usd and paying_get"
            if quote_resp.status_code == 402:
                msg = "free daily quota used up and " + msg
            raise BotsRatedError(msg, "paid_disabled", quote_resp.status_code)
        if quote_resp.status_code != 402:
            try:
                err = quote_resp.json().get("error") or {}
            except ValueError:
                err = {}
            raise BotsRatedError(
                err.get("message") or f"expected 402, got {quote_resp.status_code}",
                err.get("code") or "unexpected_status",
                quote_resp.status_code,
            )
        terms = read_payment_required(quote_resp)
        accepts = terms.get("accepts") if isinstance(terms, dict) else None
        # Fail closed: the payment client re-reads the 402 and picks an option itself, so every option
        # has to be one this client is willing to pay, not just one of them.
        if (
            not isinstance(terms, dict)
            or terms.get("x402Version") != 2
            or not extensions_ok(terms.get("extensions"))
            or not isinstance(accepts, list)
            or not accepts
            or not all(isinstance(a, dict) and self.acceptable_payment(a, PAID_ROUTE_MAX_ATOMIC[route]) for a in accepts)
        ):
            raise BotsRatedError(
                "every payment option must be exact EIP-3009 Base USDC to BotsRated at or below the published price, "
                "with no payment extensions",
                "terms_rejected",
            )
        amount = max(int(a["amount"]) for a in accepts)
        self.budget.reserve(amount)
        try:
            resp = self._paying_get(self.base_url + path)
        except Exception:
            # A signed payment may already have settled: keep it counted so the budget is a hard ceiling.
            self.budget.commit(amount)
            raise
        if not 200 <= resp.status_code < 300:
            self.budget.commit(amount)
            raise BotsRatedError(
                f"paid {route} returned {resp.status_code}; the amount stays counted against the budget in case it settled",
                "paid_call_failed",
                resp.status_code,
            )
        out = resp.json()
        # The payer may have signed before this answer, so even a free-quota body keeps the amount counted.
        self.budget.commit(amount)
        if is_free_quota_answer(out):
            self.last_free_quota = out["free_quota"]
        return out
