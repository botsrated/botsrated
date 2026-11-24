"""Repro tests for the Nov 24 audit, findings A and B (Python guard). Each failed on 0.3.5 and passes on 0.3.7."""

import pytest

from botsrated.guard import GuardPolicy, SellerFacts, as_requirements, evaluate_payment
from botsrated.payment_guard import PaymentGuardPolicy, policy_quote

EVM = "0x1111111111111111111111111111111111111111"
SOL_PAY = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
ROUTE = "https://seller.example/api/x"


# Finding A: a policy that cannot be read refuses to start, loudly.
@pytest.mark.parametrize("kwargs", [{"pay_to_mismatch": "blok"}, {"price_above_observed": "Block"}, {"network_not_observed": None}])
def test_unreadable_payment_guard_policy_raises(kwargs):
    with pytest.raises(ValueError, match="cannot be read"):
        PaymentGuardPolicy(**kwargs)


@pytest.mark.parametrize("kwargs", [{"pay_to_mismatch": "blok"}, {"not_covered": "warn"}, {"require_request_url": "yes"}, {"min_valid_402_rate": "0.9"}])
def test_unreadable_guard_policy_raises(kwargs):
    with pytest.raises(ValueError, match="cannot be read"):
        GuardPolicy(**kwargs)


def test_valid_policies_still_construct():
    PaymentGuardPolicy(pay_to_mismatch="block")
    GuardPolicy(pay_to_mismatch="block", not_covered="block", min_valid_402_rate=0.9, require_request_url=True)


def test_solana_pay_to_is_compared_not_dropped():
    facts = SellerFacts(covered=True, host="seller.example", source="preflight", known_pay_tos=[SOL_PAY], observed_network="solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")
    strict = GuardPolicy(pay_to_mismatch="block")
    same = {"payTo": SOL_PAY, "amount": "10", "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"}
    assert evaluate_payment(facts, same, ROUTE, strict).action == "allow"
    other = dict(same, payTo="9" + SOL_PAY[1:])
    assert evaluate_payment(facts, other, ROUTE, strict).action == "block"


# Finding B: x402 v1 quotes carry the price in maxAmountRequired.
def test_v1_quote_amount_reaches_remote_policy():
    quote = policy_quote({"payTo": EVM, "maxAmountRequired": "999999999", "network": "base"})
    assert quote.get("amount") == "999999999"


def test_v1_quote_amount_hits_price_rule():
    facts = SellerFacts(covered=True, host="seller.example", source="preflight", known_pay_tos=[EVM], observed_network="base", probed_url=ROUTE, observed_amount="1000")
    req = {"payTo": EVM, "maxAmountRequired": "999999999", "network": "base"}
    assert as_requirements(req)["amount"] == "999999999"
    decision = evaluate_payment(facts, req, ROUTE, GuardPolicy(price_above_observed="block"))
    assert decision.action == "block"
    assert any(r.code == "price_above_observed" for r in decision.reasons)


def test_v2_amount_wins_when_present():
    assert as_requirements({"amount": "5", "maxAmountRequired": "999999999"})["amount"] == "5"
