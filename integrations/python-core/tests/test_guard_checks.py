"""The four checks from the live Guard page, on the packages pip install runs."""

from __future__ import annotations

import dataclasses
import json
import time
from types import SimpleNamespace

import httpx
import pytest

from botsrated import BASE_USDC, PaymentGuard, PaymentGuardPolicy, PrePaymentGuard
from botsrated.guard import (
    STRICT_GUARD_POLICY,
    GuardPolicy,
    evaluate_payment,
    facts_from,
)
from botsrated.guard_checks import (
    REPLAY_TESTED,
    delivery_fact,
    evaluate_delivery,
    payto_base58_assessment,
)
from botsrated.payment_guard import POLICIES, interpret_policy_body

USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"


def req(found, **over):
    row = {
        "scheme": "exact",
        "network": "eip155:8453",
        "asset": USDC,
        "payTo": found["latest_probe"]["live_payTo"],
        "amount": found["latest_probe"]["live_amount"],
        "maxTimeoutSeconds": 60,
        "extra": {"name": "USD Coin", "version": "2"},
    }
    row.update(over)
    return row


def ctx(resource_url, row, extensions=None):
    payment = {"x402Version": 2, "resource": {"url": resource_url}, "accepts": [row]}
    if extensions:
        payment["extensions"] = extensions
    return {"payment_required": payment, "selected_requirements": row}


class _Recorder:
    def __init__(self, answer):
        self.requests = []
        self.answer = answer

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.answer(request)


def guard_with(found, answer=None, **kw):
    rec = _Recorder(answer or (lambda _request: httpx.Response(200, json=found)))
    return PaymentGuard(http=httpx.Client(transport=httpx.MockTransport(rec)), **kw), rec

SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
SOL_KEY = "EPjFWdd5AufqSSQEm2Qn1xzybapC8G4wEGGkZwyTDt1v"
PAY_ID = "pay_0123456789abcdef0123456789abcdef"
NONCE = "0x" + "ab" * 32
SCHEMA = {"type": "object", "required": ["ok"], "properties": {"ok": {"type": "boolean"}}}


def _with_id(found, payment_id=PAY_ID, **over):
    row = req(found, **over)
    return ctx(found["latest_probe"]["url"], row, {"payment-identifier": {"info": {"id": payment_id}}})


def test_repeat_payment_warns_and_does_not_call_out(found):
    clock = {"t": 1_000.0}
    seen = []
    g, rec = guard_with(found, hosted=False, on_decision=seen.append)
    g._repeats.now = lambda: clock["t"]
    url = found["latest_probe"]["url"]
    first = _with_id(found)
    with g.request(url):
        assert g.before_payment_creation(first) is None
    assert "repeat_payment" not in [r.code for r in seen[0].reasons]

    with g.request(url):
        assert g.before_payment_creation(first) is None
    repeat = next(r for r in seen[1].reasons if r.code == "repeat_payment")
    assert repeat.effect == "warn" and seen[1].action == "allow" and not seen[1].would_block
    assert "replay_tested is false" in repeat.fact

    with g.request(url):
        assert g.before_payment_creation(first) is None
    third = [r for r in seen[2].reasons if r.code == "repeat_payment"]
    assert len(third) == 1 and third[0].effect == "warn" and seen[2].action == "allow"
    assert REPLAY_TESTED is False
    assert rec.requests == []

    clock["t"] += 60
    with g.request(url):
        g.before_payment_creation(first)
    assert "repeat_payment" not in [r.code for r in seen[-1].reasons]

    blocked = []
    closing, _ = guard_with(found, hosted=False, policy=PaymentGuardPolicy(repeat_payment="block"), on_decision=blocked.append)
    closing._repeats.now = lambda: clock["t"]
    other = _with_id(found, "pay_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    with closing.request(url):
        assert closing.before_payment_creation(other) is None
        assert closing.before_payment_creation(other) is not None
    assert any(r.code == "repeat_payment" and r.effect == "block" for r in blocked[1].reasons)
    assert POLICIES["strict"].repeat_payment == "warn"


def test_repeat_tuple_needs_the_same_nonce(found):
    seen = []
    g, _ = guard_with(found, hosted=False, on_decision=seen.append)
    url = found["latest_probe"]["url"]

    def row(nonce):
        return req(found, extra={"nonce": nonce, "name": "USD Coin", "version": "2"})

    with g.request(url):
        g.before_payment_creation(ctx(url, row(NONCE)))
        g.before_payment_creation(ctx(url, row(NONCE)))
    assert any(r.code == "repeat_payment" and r.effect == "warn" for r in seen[1].reasons)
    with g.request(url):
        g.before_payment_creation(ctx(url, row("0x" + "cd" * 32)))
    assert "repeat_payment" not in [r.code for r in seen[2].reasons]


def test_payto_base58_format_matches_the_live_examples(found):
    assert BASE_USDC == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    assert payto_base58_assessment(SOL, SOL_KEY) == {"applies": True, "valid": True, "code": "payto_base58_format"}
    assert payto_base58_assessment(SOL, "not-a-key") == {"applies": True, "valid": False, "code": "payto_base58_format"}
    assert payto_base58_assessment("eip155:8453", "0x1111111111111111111111111111111111111111") == {
        "applies": False,
        "valid": None,
        "code": "payto_base58_format",
    }

    seen = []
    g, _ = guard_with(found, hosted=False, on_decision=seen.append)
    url = found["latest_probe"]["url"]
    bad = ctx(url, req(found, network=SOL, payTo="not-a-key"))
    with g.request(url):
        assert g.before_payment_creation(bad) is None
    codes = [r.code for r in seen[0].reasons]
    assert "payto_base58_format" in codes and "payto_invalid" not in codes
    assert any(r.code == "payto_base58_format" and r.effect == "warn" for r in seen[0].reasons)
    good = ctx(url, req(found, network=SOL, payTo=SOL_KEY))
    with g.request(url):
        g.before_payment_creation(good)
    good_codes = [r.code for r in seen[1].reasons]
    assert "payto_base58_format" not in good_codes and "payto_invalid" not in good_codes
    facts = facts_from(found, "blockrun.ai", "preflight")
    invalid = [r.code for r in evaluate_payment(facts, req(found, network=SOL, payTo="not-a-key"), url).reasons]
    assert "payto_base58_format" in invalid and "payto_invalid" not in invalid
    valid = [r.code for r in evaluate_payment(facts, req(found, network=SOL, payTo=SOL_KEY), url).reasons]
    assert "payto_base58_format" not in valid and "payto_invalid" not in valid
    assert "payto_invalid" in [r.code for r in evaluate_payment(facts, req(found, payTo="junk"), url).reasons]

    base = []
    judging, _ = guard_with(found, hosted=False, policy=PaymentGuardPolicy(pay_to_base58_format="block"), on_decision=base.append)
    with judging.request(url):
        assert judging.before_payment_creation(ctx(url, req(found, payTo="not-a-key"))) is None
    assert "payto_base58_format" not in [r.code for r in base[0].reasons]
    with judging.request(url):
        assert judging.before_payment_creation(bad) is not None
    assert POLICIES["carefulBuyer"].pay_to_base58_format == "warn"


def test_quote_above_listing_warns_on_the_same_route(found):
    facts = facts_from(found, "blockrun.ai", "preflight")
    assert facts.listed_amount == "2000"
    above = evaluate_payment(facts, req(found, amount="2001"), found["latest_probe"]["url"])
    assert above.action == "allow"
    assert any(r.code == "quote_above_listing" and r.effect == "warn" for r in above.reasons)
    assert "quote_above_listing" not in [r.code for r in evaluate_payment(facts, req(found), found["latest_probe"]["url"]).reasons]
    assert "quote_above_listing" not in [r.code for r in evaluate_payment(facts, req(found, amount="9000"), "https://blockrun.ai/other").reasons]
    assert evaluate_payment(facts, req(found, amount="2001"), found["latest_probe"]["url"], GuardPolicy(quote_above_listing="block")).action == "block"


def test_server_quote_above_listing_is_not_collapsed(found):
    only = interpret_policy_body(
        200,
        {"decision": "block", "reasons": [{"rule": "quote_above_listing", "effect": "block", "fact": "quoted 2000 atomic units; listed 1000."}]},
        "open",
        "blockrun.ai",
    )
    assert only.code is None and "listed 1000" in only.quote_above_listing_fact

    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/v1/policy/check"):
            return httpx.Response(200, json={"decision": "block", "reasons": [{"rule": "quote_above_listing", "effect": "block", "fact": "quoted 2000 atomic units; listed 1000."}]})
        return httpx.Response(200, json=found)

    seen = []
    g, _ = guard_with(found, answer=answer, on_decision=seen.append, remote_policy={"token": "policy-token-1", "fail_mode": "open"})
    url = found["latest_probe"]["url"]
    with g.request(url):
        assert g.before_payment_creation(ctx(url, req(found))) is None
    assert seen[0].action == "allow" and seen[0].remote_decision == "block"
    assert any(r.code == "quote_above_listing" and r.effect == "warn" for r in seen[0].reasons)
    assert "remote_policy" not in [r.code for r in seen[0].reasons]

    stopping, _ = guard_with(
        found,
        answer=answer,
        policy=PaymentGuardPolicy(quote_above_listing="block"),
        remote_policy={"token": "policy-token-1", "fail_mode": "open"},
    )
    with stopping.request(url):
        assert stopping.before_payment_creation(ctx(url, req(found))) is not None


def test_delivery_check_examples_and_wrap(found):
    empty = evaluate_delivery(status=200, body=b"", content_type="application/json")
    assert empty["code"] == "delivery_check" and empty["blocks_by_default"] is False
    assert delivery_fact(empty) == "a 2xx is not a delivery. The body is empty."
    assert "did not all match" not in delivery_fact(empty)
    assert empty["rule"] == "a 2xx is not a delivery"
    assert empty["checks"] == {"http_2xx": True, "body_non_empty": False, "content_type_sane": True, "schema": "not_declared"}
    assert empty["outcome"] == "not_a_delivery" and empty["effect"] == "warn"

    delivered = evaluate_delivery(status=200, body=b'{"ok": true}', content_type="application/json; charset=utf-8", schema=SCHEMA)
    assert delivered["outcome"] == "delivered" and delivered["effect"] == "allow" and delivered["checks"]["schema"] == "pass"
    undeclared = evaluate_delivery(status=200, body=b'{"ok": true}', content_type="application/json")
    assert undeclared["checks"]["schema"] == "not_declared" and undeclared["effect"] == "warn"
    assert delivery_fact(undeclared) == "a 2xx is not a delivery. The seller declared no JSON schema for this response."
    assert evaluate_delivery(status=200, body=b"<p>x</p>", content_type="text/html")["checks"]["content_type_sane"] is False

    seen = []
    g, _ = guard_with(found, hosted=False, on_decision=seen.append)
    url = found["latest_probe"]["url"]
    payload = {
        "x402Version": 2,
        "payload": {"authorization": {"from": "0x" + "a" * 40, "nonce": NONCE, "validBefore": "9999999999"}},
        "accepted": req(found),
    }

    def paid_get(target, **kwargs):
        with g.request(target):
            g.before_payment_creation(ctx(url, req(found)))
            g.after_payment_creation({"payment_payload": payload, "selected_requirements": req(found)})
        return httpx.Response(200, content=b"", headers={"content-type": "application/json"})

    assert g.wrap_get(paid_get)(url).status_code == 200
    delivery = [d for d in seen if any(r.code == "delivery_check" for r in d.reasons)]
    assert len(delivery) == 1 and delivery[0].action == "allow" and not delivery[0].would_block
    assert delivery[0].reasons[0].effect == "warn"

    matched = []
    ok, _ = guard_with(found, hosted=False, on_decision=matched.append)

    def matched_get(target, **kwargs):
        body = ctx(url, req(found), {"bazaar": {"info": {"output": {"schema": SCHEMA}}}})
        with ok.request(target):
            ok.before_payment_creation(body)
            ok.after_payment_creation({"payment_payload": payload, "selected_requirements": req(found)})
        return httpx.Response(200, content=json.dumps({"ok": True}).encode(), headers={"content-type": "application/json"})

    ok.wrap_get(matched_get)(url)
    assert not any(any(r.code == "delivery_check" for r in d.reasons) for d in matched)


def test_pre_payment_guard_repeat_and_delivery(found):
    pytest.importorskip("httpx")

    class Client:
        host = "botsrated.com"

        def preflight(self, host):
            return type("P", (), {"found": True, "body": found})()

        def unpaid_http(self):
            raise AssertionError("repeat and delivery do not call out")

    seen = []
    guard = PrePaymentGuard(client=Client(), on_decision=seen.append)  # type: ignore[arg-type]
    url = found["latest_probe"]["url"]

    def paid_get(target, **kwargs):
        guard.decide(url, req(found, extra={"nonce": NONCE, "name": "USD Coin", "version": "2"}), request_url=url)
        return httpx.Response(200, content=b"", headers={"content-type": "application/json"})

    guard.wrap_get(paid_get)(url)
    assert any(any(r.code == "delivery_check" and r.effect == "warn" for r in d.reasons) for d in seen)
    second = guard.decide(url, req(found, extra={"nonce": NONCE, "name": "USD Coin", "version": "2"}), request_url=url)
    assert second.action == "allow"
    assert any(r.code == "repeat_payment" and r.effect == "warn" for r in second.reasons)


def test_no_delivery_check_when_the_pre_payment_hook_blocks(found):
    pytest.importorskip("x402")

    class Client:
        host = "botsrated.com"

        def preflight(self, host):
            return type("P", (), {"found": True, "body": found})()

    seen = []
    guard = PrePaymentGuard(client=Client(), policy=GuardPolicy(pay_to_mismatch="block"), on_decision=seen.append)  # type: ignore[arg-type]
    url = found["latest_probe"]["url"]
    dead = "0x000000000000000000000000000000000000dEaD"

    def paid_get(target, **kwargs):
        context = SimpleNamespace(
            payment_required=SimpleNamespace(resource=SimpleNamespace(url=url), extensions=None),
            selected_requirements=req(found, payTo=dead),
        )
        out = guard.x402_hook(context)
        assert out is not None
        return httpx.Response(200, content=b"", headers={"content-type": "application/json"})

    guard.wrap_get(paid_get)(url)
    assert not any(any(r.code == "delivery_check" for r in d.reasons) for d in seen)


def test_schema_work_budget_stops_a_huge_seller_schema():
    schema = {"type": "array", "items": {"anyOf": [{"const": "nope"} for _ in range(1999)] + [{"const": "x"}]}}
    body = json.dumps(["x"] * 40).encode()
    started = time.perf_counter()
    check = evaluate_delivery(status=200, body=body, content_type="application/json", schema=schema)
    assert time.perf_counter() - started < 0.5
    assert check["checks"]["schema"] == "not_evaluated"
    assert check["effect"] == "warn"
    assert delivery_fact(check) == "a 2xx is not a delivery. The declared JSON schema was too large to evaluate."


def test_schema_budget_covers_properties_additional_and_enum():
    properties = {f"p{i}": {} for i in range(6000)}
    body = json.dumps([{} for _ in range(10)]).encode()
    shapes = [
        {"type": "array", "items": {"type": "object", "properties": properties}},
        {"type": "array", "items": {"type": "object", "properties": properties, "additionalProperties": False}},
        {"type": "array", "items": {"enum": [0] * 20999 + [1]}},
    ]
    enum_body = json.dumps([1]).encode()
    for index, schema in enumerate(shapes):
        started = time.perf_counter()
        check = evaluate_delivery(status=200, body=enum_body if index == 2 else body, content_type="application/json", schema=schema)
        assert time.perf_counter() - started < 0.5
        assert check["checks"]["schema"] == "not_evaluated"
        assert check["effect"] == "warn"


def test_strict_payto_rows_keep_non_solana_blocks_and_compare_solana(found):
    facts = facts_from(found, "blockrun.ai", "preflight")
    url = found["latest_probe"]["url"]

    def codes(network, pay_to):
        row = req(found, payTo=pay_to)
        if network is None:
            row.pop("network", None)
        else:
            row["network"] = network
        decision = evaluate_payment(facts, row, url, STRICT_GUARD_POLICY)
        return decision.action, [r.code for r in decision.reasons]

    action, got = codes("eip155:8453", "nothex")
    assert action == "block" and "payto_invalid" in got
    action, got = codes("aptos:1", "garbage")
    assert action == "block" and "payto_invalid" in got and "payto_base58_format" not in got
    action, got = codes(None, "garbage")
    assert action == "block" and "payto_invalid" in got
    action, got = codes(SOL, "not-a-key")
    assert action == "allow" and "payto_base58_format" in got and "payto_invalid" not in got
    other = "So11111111111111111111111111111111111111112"
    sol_facts = dataclasses.replace(facts, observed_network=SOL, known_pay_tos=[SOL_KEY])
    swapped = evaluate_payment(sol_facts, req(found, network=SOL, payTo=other), url, STRICT_GUARD_POLICY)
    swapped_codes = [r.code for r in swapped.reasons]
    assert swapped.action == "block" and "payto_not_observed" in swapped_codes and "payto_invalid" not in swapped_codes
    matched = evaluate_payment(sol_facts, req(found, network=SOL, payTo=SOL_KEY), url, STRICT_GUARD_POLICY)
    matched_codes = [r.code for r in matched.reasons]
    assert "payto_invalid" not in matched_codes
    assert "payto_base58_format" not in matched_codes
    assert "payto_not_observed" not in matched_codes
    _action, unseen = codes(SOL, SOL_KEY)
    assert "network_not_observed" in unseen
    assert "payto_invalid" not in unseen

    other = "So11111111111111111111111111111111111111112"
    missing = dataclasses.replace(facts, observed_network=None, known_pay_tos=[SOL_KEY])
    swapped = evaluate_payment(missing, req(found, network=SOL, payTo=other), url, STRICT_GUARD_POLICY)
    assert swapped.action == "block"
    assert "payto_not_observed" in [r.code for r in swapped.reasons]
    assert not any("eip155 addresses" in r.detail for r in swapped.reasons)
    matched_missing = evaluate_payment(missing, req(found, network=SOL, payTo=SOL_KEY), url, STRICT_GUARD_POLICY)
    matched_codes = [r.code for r in matched_missing.reasons]
    assert "payto_not_observed" not in matched_codes and "network_not_observed" not in matched_codes
    hex_only = dataclasses.replace(facts, observed_network=None, known_pay_tos=list(facts.known_pay_tos), listing_pay_to=None)
    hex_decision = evaluate_payment(hex_only, req(found, network=SOL, payTo=SOL_KEY), url, STRICT_GUARD_POLICY)
    assert any(r.code == "network_not_observed" and "eip155 addresses" in r.detail for r in hex_decision.reasons)
    alias = dataclasses.replace(facts, observed_network=SOL, known_pay_tos=[SOL_KEY])
    alias_decision = evaluate_payment(alias, req(found, network="solana", payTo=other), url, STRICT_GUARD_POLICY)
    alias_codes = [r.code for r in alias_decision.reasons]
    assert alias_decision.action == "block" and "payto_not_observed" in alias_codes and "network_not_observed" not in alias_codes
    devnet = dataclasses.replace(facts, observed_network="solana-devnet", known_pay_tos=[SOL_KEY])
    devnet_codes = [r.code for r in evaluate_payment(devnet, req(found, network=SOL, payTo=other), url, STRICT_GUARD_POLICY).reasons]
    assert "network_not_observed" in devnet_codes
    base_alias = evaluate_payment(facts, req(found, network="base", payTo="0x000000000000000000000000000000000000dEaD"), url, STRICT_GUARD_POLICY)
    base_codes = [r.code for r in base_alias.reasons]
    assert base_alias.action == "block" and "payto_not_observed" in base_codes and "network_not_observed" not in base_codes


def test_unread_streaming_response_does_not_raise(found):
    class Unread:
        status_code = 200

        @property
        def headers(self):
            return {"content-type": "text/event-stream"}

        @property
        def content(self):
            raise httpx.ResponseNotRead()

    class Client:
        host = "botsrated.com"

        def preflight(self, host):
            return type("P", (), {"found": True, "body": found})()

    guard = PrePaymentGuard(client=Client())  # type: ignore[arg-type]
    url = found["latest_probe"]["url"]

    def paid_get(target, **kwargs):
        guard.decide(url, req(found, extra={"nonce": NONCE, "name": "USD Coin", "version": "2"}), request_url=url)
        return Unread()

    assert guard.wrap_get(paid_get)(url).status_code == 200

    g, _ = guard_with(found, hosted=False)
    payload = {
        "x402Version": 2,
        "payload": {"authorization": {"from": "0x" + "a" * 40, "nonce": NONCE, "validBefore": "9999999999"}},
        "accepted": req(found),
    }

    def paid_payment_get(target, **kwargs):
        with g.request(target):
            g.before_payment_creation(ctx(url, req(found)))
            g.after_payment_creation({"payment_payload": payload, "selected_requirements": req(found)})
        return Unread()

    assert g.wrap_get(paid_payment_get)(url).status_code == 200
