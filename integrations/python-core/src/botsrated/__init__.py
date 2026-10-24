"""BotsRated: the payment guard for x402 agents, plus BotsRated's free preflight and opt-in paid lookups.

BotsRated is independent and is not affiliated with or endorsed by Coinbase, the x402 Foundation or any seller.
"""

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
from botsrated.onchain import (
    DEFAULT_BASE_RPCS,
    PaymentRecord,
    PaymentState,
    acheck_payment_state,
    check_payment_state,
)
from botsrated.payment_guard import (
    POLICIES,
    GuardDecision,
    GuardFacts,
    GuardReason,
    PaymentGuard,
    PaymentGuardPolicy,
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
    "SellerFacts",
    "acheck_payment_state",
    "check_payment_state",
    "current_request_url",
    "evaluate_payment",
    "facts_from",
    "host_of",
    "is_atomic_amount",
    "is_free_quota_answer",
    "paying_request",
    "usd_to_atomic",
]
