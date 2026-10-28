"""BotsRated: the payment guard for x402 agents, plus BotsRated's free preflight and opt-in paid lookups.

BotsRated is independent and is not affiliated with or endorsed by Coinbase, the x402 Foundation or any seller.
"""

from typing import TYPE_CHECKING, Any

from botsrated.onchain import (
    DEFAULT_BASE_RPCS,
    PaymentRecord,
    PaymentState,
    acheck_payment_state,
    check_payment_state,
)
from botsrated.payment_guard import (
    POLICIES,
    PRESETS,
    GuardDecision,
    GuardFacts,
    GuardReason,
    PaymentGuard,
    PaymentGuardPolicy,
    RemotePolicy,
    dry_run_only,
)
from botsrated.util import (
    BASE_MAINNET,
    BASE_USDC,
    BOTSRATED_BASE_URL,
    DISPUTE_URL,
    PRIVACY_URL,
    TERMS_URL,
    USER_AGENT,
    VERSION,
    BotsRatedError,
    host_of,
    is_atomic_amount,
)

# The guard-only path (botsrated.payment_guard, botsrated.onchain, botsrated.util) never loads the signing client.
# BotsRatedClient and the legacy PrePaymentGuard (which uses it) load on first access (PEP 562), so
# ``import botsrated`` / ``from botsrated import PaymentGuard`` keep botsrated.client out of the process.
_LAZY: dict[str, str] = {
    "BOTSRATED_PAY_TO": "botsrated.client",
    "FREE_DAILY_QUOTA": "botsrated.client",
    "PAID_ROUTE_MAX_ATOMIC": "botsrated.client",
    "BotsRatedClient": "botsrated.client",
    "Budget": "botsrated.client",
    "PreflightResult": "botsrated.client",
    "current_request_url": "botsrated.client",
    "is_free_quota_answer": "botsrated.client",
    "paying_request": "botsrated.client",
    "usd_to_atomic": "botsrated.client",
    "STRICT_GUARD_POLICY": "botsrated.guard",
    "Decision": "botsrated.guard",
    "GuardPolicy": "botsrated.guard",
    "PrePaymentGuard": "botsrated.guard",
    "Reason": "botsrated.guard",
    "SellerFacts": "botsrated.guard",
    "evaluate_payment": "botsrated.guard",
    "facts_from": "botsrated.guard",
}

if TYPE_CHECKING:  # pragma: no cover - for type checkers and IDEs only
    from botsrated.client import (
        BOTSRATED_PAY_TO,
        FREE_DAILY_QUOTA,
        PAID_ROUTE_MAX_ATOMIC,
        BotsRatedClient,
        Budget,
        PreflightResult,
        current_request_url,
        is_free_quota_answer,
        paying_request,
        usd_to_atomic,
    )
    from botsrated.guard import (
        STRICT_GUARD_POLICY,
        Decision,
        GuardPolicy,
        PrePaymentGuard,
        Reason,
        SellerFacts,
        evaluate_payment,
        facts_from,
    )


def __getattr__(name: str) -> Any:
    mod = _LAZY.get(name)
    if mod is None:
        raise AttributeError(f"module 'botsrated' has no attribute {name!r}")
    import importlib

    value = getattr(importlib.import_module(mod), name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(_LAZY))


__version__ = VERSION

__all__ = [
    "BASE_MAINNET",
    "BASE_USDC",
    "BOTSRATED_BASE_URL",
    "BOTSRATED_PAY_TO",
    "DEFAULT_BASE_RPCS",
    "DISPUTE_URL",
    "FREE_DAILY_QUOTA",
    "PAID_ROUTE_MAX_ATOMIC",
    "POLICIES",
    "PRESETS",
    "PRIVACY_URL",
    "STRICT_GUARD_POLICY",
    "TERMS_URL",
    "USER_AGENT",
    "VERSION",
    "BotsRatedClient",
    "BotsRatedError",
    "Budget",
    "Decision",
    "GuardDecision",
    "GuardFacts",
    "GuardPolicy",
    "GuardReason",
    "PaymentGuard",
    "PaymentGuardPolicy",
    "PaymentRecord",
    "PaymentState",
    "PrePaymentGuard",
    "PreflightResult",
    "Reason",
    "RemotePolicy",
    "SellerFacts",
    "acheck_payment_state",
    "check_payment_state",
    "current_request_url",
    "dry_run_only",
    "evaluate_payment",
    "facts_from",
    "host_of",
    "is_atomic_amount",
    "is_free_quota_answer",
    "paying_request",
    "usd_to_atomic",
]
