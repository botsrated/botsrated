"""Python and TypeScript must read the same facts and reach the same reasons for the same preflight body.

The cases live in integrations/fixtures/guard-facts-parity.json and are also run by
integrations/x402-client/test/guard-facts-parity.test.ts.
"""

import json
from pathlib import Path

import pytest

from botsrated.payment_guard import POLICIES, evaluate_facts, guard_facts_from

DOC = json.loads((Path(__file__).resolve().parents[2] / "fixtures" / "guard-facts-parity.json").read_text())
CASES = DOC["cases"]
SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"


@pytest.mark.parametrize("row", CASES, ids=[c["name"] for c in CASES])
def test_facts_and_reasons_match_the_shared_cases(row):
    facts = guard_facts_from(row["body"], DOC["host"])
    assert facts.known_pay_tos == row["known_pay_tos"]
    assert facts.listing_pay_to == row["listing_pay_to"]
    assert facts.quotes_by_network == row["quotes_by_network"]
    for name in ("warn", "strict"):
        reasons = evaluate_facts(facts, row["request"], DOC["paid_url"], POLICIES[name])
        assert [[r.code, r.effect] for r in reasons] == row[name], name


def test_a_swapped_solana_pay_to_is_stopped_on_strict():
    recorded = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
    other = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
    body = {"found": True, "latest_probe": {"live_payTo": recorded, "live_network": SOL, "live_amount": "1000", "url": DOC["paid_url"]}}
    facts = guard_facts_from(body, DOC["host"])
    assert facts.known_pay_tos == [recorded]  # base58 is kept, exact case
    same = evaluate_facts(facts, {"payTo": recorded, "network": SOL, "amount": "1000"}, DOC["paid_url"], POLICIES["strict"])
    assert same == []
    swapped = evaluate_facts(facts, {"payTo": other, "network": SOL, "amount": "1000"}, DOC["paid_url"], POLICIES["strict"])
    assert [(r.code, r.effect) for r in swapped] == [("payto_not_observed", "block")]
    assert recorded.lower() not in facts.known_pay_tos  # a base58 key is never lower-cased


def test_a_hex_pay_to_is_still_compared_when_the_request_has_no_network():
    one, two = "0x" + "11" * 20, "0x" + "22" * 20
    facts = guard_facts_from({"found": True, "latest_probe": {"live_payTo": one, "live_network": "eip155:8453"}}, DOC["host"])
    reasons = evaluate_facts(facts, {"payTo": two, "amount": "1"}, None, POLICIES["strict"])
    assert [(r.code, r.effect) for r in reasons] == [("payto_not_observed", "block")]
