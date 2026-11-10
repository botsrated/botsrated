"""The four checks from the live Guard page, on the packages pip install runs."""

from __future__ import annotations

import json

import httpx
import pytest

from botsrated import BASE_USDC, PaymentGuard, PaymentGuardPolicy, PrePaymentGuard
from botsrated.guard import GuardPolicy, evaluate_payment, facts_from
from botsrated.guard_checks import REPLAY_TESTED, evaluate_delivery, payto_base58_assessment
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
    assert any(r.code == "payto_base58_format" and r.effect == "warn" for r in seen[0].reasons)
    good = ctx(url, req(found, network=SOL, payTo=SOL_KEY))
    with g.request(url):
        g.before_payment_creation(good)
    assert "payto_base58_format" not in [r.code for r in seen[1].reasons]

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
    assert empty["rule"] == "a 2xx is not a delivery"
    assert empty["checks"] == {"http_2xx": True, "body_non_empty": False, "content_type_sane": True, "schema": "not_declared"}
    assert empty["outcome"] == "not_a_delivery" and empty["effect"] == "warn"

    delivered = evaluate_delivery(status=200, body=b'{"ok": true}', content_type="application/json; charset=utf-8", schema=SCHEMA)
    assert delivered["outcome"] == "delivered" and delivered["effect"] == "allow" and delivered["checks"]["schema"] == "pass"
    undeclared = evaluate_delivery(status=200, body=b'{"ok": true}', content_type="application/json")
    assert undeclared["checks"]["schema"] == "not_declared" and undeclared["effect"] == "warn"
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
