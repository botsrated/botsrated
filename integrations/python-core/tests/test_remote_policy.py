"""Remote policy on PaymentGuard and PrePaymentGuard.

A remote block stops the payment. HTTP 503, 404 and decision null follow fail_mode.
A missing decision is never stored as a pass, and the check is not signed.
"""

from __future__ import annotations

import json

import httpx
import pytest

from botsrated import (
    POLICIES,
    STRICT_GUARD_POLICY,
    PaymentGuard,
    PrePaymentGuard,
    RemotePolicy,
)
from botsrated.client import BotsRatedClient
from botsrated.payment_guard import interpret_policy_body, reset_hosted_lookup_circuit

DEAD = "0x000000000000000000000000000000000000dEaD"


def req(found, **over):
    row = {
        "scheme": "exact",
        "network": "eip155:8453",
        "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "payTo": found["latest_probe"]["live_payTo"],
        "amount": found["latest_probe"]["live_amount"],
        "maxTimeoutSeconds": 60,
        "extra": {"name": "USD Coin", "version": "2"},
    }
    row.update(over)
    return row


def ctx(resource_url, row):
    return {"payment_required": {"x402Version": 2, "resource": {"url": resource_url}, "accepts": [row]}, "selected_requirements": row}

TOKEN = "policy-token-1"
FRAMING = {"decided_by": "your_policy", "not_a_botsrated_rating": True, "policy_version": "7"}


def _answer(found, policy):
    seen: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if path.endswith("/policy/check"):
            status, body = policy(request)
            return httpx.Response(status, json=body)
        return httpx.Response(200, json=found)

    return seen, respond


def _payment_guard(found, handler, **kw):
    seen, respond = _answer(found, handler)
    guard = PaymentGuard(http=httpx.Client(transport=httpx.MockTransport(respond)), **kw)
    return guard, seen


def _pre(found, handler, **kw):
    seen, respond = _answer(found, handler)
    client = BotsRatedClient(http=httpx.Client(transport=httpx.MockTransport(respond)))
    return PrePaymentGuard(client, **kw), seen


def _policy_bodies(seen: list[httpx.Request]) -> list[dict]:
    out = []
    for request in seen:
        if request.url.path.endswith("/policy/check"):
            out.append(json.loads(request.content))
    return out


def test_unset_remote_policy_keeps_local_presets_and_does_not_post(found):
    guard, seen = _payment_guard(found, lambda r: (200, {}), policy=POLICIES["carefulBuyer"])
    url = found["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(ctx(url, req(found, payTo=DEAD)))
    assert decision.action == "block" and decision.policy_rule == "payToMismatch"
    assert decision.remote_decision is None
    assert _policy_bodies(seen) == []
    assert all("/v1/preflight" in str(r.url) for r in seen)


def test_remote_block_wins_over_a_local_allow(found):
    def policy(_request):
        return 200, {"decision": "block", **FRAMING}

    guard, seen = _payment_guard(found, policy, remote_policy={"token": TOKEN, "fail_mode": "open"})
    url = found["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(ctx(url, req(found)))
    assert decision.action == "block"
    assert decision.policy_rule == "remotePolicy"
    assert decision.remote_decision == "block"
    assert decision.decided_by == "your_policy"
    assert decision.not_a_botsrated_rating is True
    assert decision.policy_version == "7"
    assert guard.remote_policy_version == "7"
    body = _policy_bodies(seen)[0]
    assert body["host"] == "blockrun.ai"
    assert set(body) == {"host", "quote"}
    assert set(body["quote"]) <= {"payTo", "amount", "asset", "network"}
    assert body["quote"]["payTo"] == found["latest_probe"]["live_payTo"]
    assert body["quote"]["amount"] == found["latest_probe"]["live_amount"]
    posted = next(r for r in seen if r.url.path.endswith("/policy/check"))
    assert posted.headers["authorization"] == f"Bearer {TOKEN}"
    assert str(posted.url) == "https://botsrated.com/v1/policy/check"


def test_remote_pass_does_not_clear_a_local_block(found):
    def policy(_request):
        return 200, {"decision": "pass", **FRAMING}

    guard, _seen = _payment_guard(found, policy, policy=POLICIES["strict"], remote_policy=RemotePolicy(TOKEN, "open"))
    url = found["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(ctx(url, req(found, payTo=DEAD)))
    assert decision.action == "block" and decision.policy_rule == "payToMismatch"
    assert decision.remote_decision == "pass"
    assert decision.decided_by == "your_policy"


def test_503_and_null_decision_follow_fail_mode_and_do_not_invent_a_pass(found):
    url = found["latest_probe"]["url"]
    cases = [
        (503, {"decision": None, **FRAMING}),
        (200, {"decision": None, "decided_by": "your_policy", "not_a_botsrated_rating": True}),
        (404, {}),
        (200, {"decision": "safe"}),
    ]
    for status, body in cases:
        reset_hosted_lookup_circuit()
        closed, _ = _payment_guard(found, lambda r, s=status, b=body: (s, b), remote_policy={"token": TOKEN, "fail_mode": "closed"})
        with closed.request(url):
            blocked = closed.decide(ctx(url, req(found)))
        assert blocked.action == "block", (status, body)
        assert blocked.remote_decision is None
        assert any(r.code == "remote_policy_unavailable" and r.effect == "block" and "fail_mode is closed" in r.fact for r in blocked.reasons)
        assert blocked.remote_decision != "pass"

        reset_hosted_lookup_circuit()
        opened, _ = _payment_guard(found, lambda r, s=status, b=body: (s, b), remote_policy={"token": TOKEN, "failMode": "open"})
        with opened.request(url):
            allowed = opened.decide(ctx(url, req(found)))
        assert allowed.action == "allow", (status, body)
        assert allowed.remote_decision is None
        assert any(r.code == "remote_policy_unavailable" and r.effect == "info" and "fail_mode is open" in r.fact for r in allowed.reasons)

    # A local block still stops the payment when fail_mode is open and the check returns nothing.
    reset_hosted_lookup_circuit()
    strict, _ = _payment_guard(
        found,
        lambda r: (503, {"decision": None}),
        policy=POLICIES["strict"],
        remote_policy={"token": TOKEN, "fail_mode": "open"},
    )
    with strict.request(url):
        decision = strict.decide(ctx(url, req(found, payTo=DEAD)))
    assert decision.action == "block" and decision.policy_rule == "payToMismatch"
    assert decision.remote_decision is None


def test_null_decision_keeps_server_framing(found):
    def policy(_request):
        return 200, {"decision": None, "decided_by": "your_policy", "not_a_botsrated_rating": True, "policy_version": "4"}

    guard, _seen = _payment_guard(found, policy, remote_policy={"token": TOKEN, "fail_mode": "open"})
    url = found["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(ctx(url, req(found)))
    assert decision.decided_by == "your_policy"
    assert decision.not_a_botsrated_rating is True
    assert decision.policy_version == "4"
    assert decision.remote_decision is None


def test_policy_check_is_not_signed_and_ignores_a_returned_signature(found):
    def policy(_request):
        return 200, {"decision": "block", "signature": "PRODKEYSIG", **FRAMING}

    guard, seen = _payment_guard(found, policy, remote_policy={"token": TOKEN, "fail_mode": "closed"})
    url = found["latest_probe"]["url"] + "?api_key=SECRET123"
    with guard.request(url):
        decision = guard.decide(ctx(url, req(found)))
    posted = [r for r in seen if r.url.path.endswith("/policy/check")]
    assert len(posted) == 1
    headers = {k.lower(): v for k, v in posted[0].headers.items()}
    assert "payment-signature" not in headers
    assert "x-payment" not in headers
    raw = posted[0].content.decode()
    assert "PRODKEYSIG" not in raw and "SECRET123" not in raw and "signature" not in raw
    assert "PRODKEYSIG" not in decision.message
    assert not hasattr(decision, "signature")
    blob = json.dumps({"message": decision.message, "reasons": [r.fact for r in decision.reasons]})
    assert TOKEN not in blob


def test_last_policy_version_is_remembered_when_the_next_check_fails(found):
    calls = {"n": 0}

    def policy(_request):
        calls["n"] += 1
        if calls["n"] == 1:
            return 200, {"decision": "pass", "policy_version": "9", "decided_by": "your_policy", "not_a_botsrated_rating": True}
        return 503, {"decision": None}

    guard, _seen = _payment_guard(found, policy, remote_policy={"token": TOKEN, "fail_mode": "closed"})
    url = found["latest_probe"]["url"]
    with guard.request(url):
        first = guard.decide(ctx(url, req(found)))
        second = guard.decide(ctx(url, req(found)))
    assert first.remote_decision == "pass" and first.policy_version == "9"
    assert second.remote_decision is None and second.action == "block"
    assert second.policy_version == "9"
    assert guard.remote_policy_version == "9"


def test_custom_base_url_and_bad_config(found):
    def policy(_request):
        return 200, {"decision": "warn"}

    guard, seen = _payment_guard(found, policy, remote_policy={"token": TOKEN, "fail_mode": "open", "baseUrl": "https://policy.example/v1/"})
    url = found["latest_probe"]["url"]
    with guard.request(url):
        decision = guard.decide(ctx(url, req(found)))
    assert decision.action == "allow"
    assert any(r.code == "remote_policy" and r.effect == "warn" for r in decision.reasons)
    posted = next(r for r in seen if r.url.path.endswith("/policy/check"))
    assert str(posted.url) == "https://policy.example/v1/policy/check"

    with pytest.raises(ValueError, match="fail_mode"):
        PaymentGuard(hosted=False, remote_policy={"token": TOKEN})
    with pytest.raises(ValueError, match="token"):
        RemotePolicy("has space", "open")


def test_pre_payment_guard_block_wins_503_and_does_not_sign(found):
    url = found["latest_probe"]["url"]

    def block(_request):
        return 200, {"decision": "block", **FRAMING, "signature": "PRODKEYSIG"}

    guard, seen = _pre(found, block, remote_policy={"token": TOKEN, "fail_mode": "open"})
    decision = guard.decide(url, req(found), request_url=url)
    assert decision.action == "block"
    assert decision.remote_decision == "block"
    assert decision.decided_by == "your_policy" and decision.not_a_botsrated_rating is True
    posted = next(r for r in seen if r.url.path.endswith("/policy/check"))
    assert "payment-signature" not in {k.lower() for k in posted.headers}
    assert "PRODKEYSIG" not in posted.content.decode()

    def down(_request):
        return 503, {"decision": None, "decided_by": "your_policy", "not_a_botsrated_rating": True}

    reset_hosted_lookup_circuit()
    closed, _ = _pre(found, down, remote_policy={"token": TOKEN, "fail_mode": "closed"})
    blocked = closed.decide(url, req(found), request_url=url)
    assert blocked.action == "block" and blocked.remote_decision is None
    assert any("fail_mode is closed" in r.detail for r in blocked.reasons)

    reset_hosted_lookup_circuit()
    opened, _ = _pre(found, down, remote_policy={"token": TOKEN, "fail_mode": "open"})
    allowed = opened.decide(url, req(found), request_url=url)
    assert allowed.action == "allow" and allowed.remote_decision is None
    assert any(r.effect == "info" and "fail_mode is open" in r.detail for r in allowed.reasons)

    # Remote pass does not clear a local block.
    reset_hosted_lookup_circuit()
    passed, _ = _pre(found, lambda r: (200, {"decision": "pass"}), policy=STRICT_GUARD_POLICY, remote_policy={"token": TOKEN, "fail_mode": "open"})
    still = passed.decide(url, req(found, payTo=DEAD), request_url=url)
    assert still.action == "block" and still.remote_decision == "pass"


def test_interpret_policy_body_never_maps_a_null_to_pass():
    effect = interpret_policy_body(503, {"decision": None}, "open", "blockrun.ai")
    assert effect.decision is None and effect.effect == "info"
    effect = interpret_policy_body(200, {"decision": None}, "closed", "blockrun.ai")
    assert effect.decision is None and effect.effect == "block"
    effect = interpret_policy_body(200, {"decision": "block"}, "open", "blockrun.ai")
    assert effect.decision == "block"
    effect = interpret_policy_body(None, {}, "closed", "blockrun.ai")
    assert effect.decision is None and effect.effect == "block"


def test_async_payment_guard_applies_fail_mode(found):
    import asyncio

    seen, respond = _answer(found, lambda r: (503, {"decision": None}))
    guard = PaymentGuard(async_http=httpx.AsyncClient(transport=httpx.MockTransport(respond)), remote_policy={"token": TOKEN, "fail_mode": "closed"})
    url = found["latest_probe"]["url"]

    async def run():
        with guard.request(url):
            return await guard.adecide(ctx(url, req(found)))

    decision = asyncio.run(run())
    assert decision.action == "block" and decision.remote_decision is None
    assert any(r.url.path.endswith("/policy/check") for r in seen)
