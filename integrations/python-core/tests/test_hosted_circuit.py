"""Hosted lookup timeout clamp and the in-process overload circuit."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx

from botsrated.payment_guard import (
    DEFAULT_HOSTED_TIMEOUT_S,
    MAX_HOSTED_TIMEOUT_S,
    PaymentGuard,
    clamp_hosted_timeout,
    reset_hosted_lookup_circuit,
)

BASE = "eip155:8453"
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
TOKEN = "policy-token-1"


def req(found, **over):
    row = {
        "scheme": "exact",
        "network": BASE,
        "asset": USDC,
        "payTo": found["latest_probe"]["live_payTo"],
        "amount": found["latest_probe"]["live_amount"],
        "maxTimeoutSeconds": 60,
        "extra": {"name": "USD Coin", "version": "2"},
    }
    row.update(over)
    return row


def ctx(resource_url, row):
    return {"payment_required": {"x402Version": 2, "resource": {"url": resource_url}, "accepts": [row]}, "selected_requirements": row}


class Spy(httpx.Client):
    def __init__(self, answer):
        super().__init__(transport=httpx.MockTransport(answer))
        self.timeouts: list[float | None] = []

    def get(self, url, **kwargs):
        self.timeouts.append(kwargs.get("timeout"))
        return super().get(url, **kwargs)


def _guard(answer, **kw):
    calls = {"n": 0}

    def respond(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return answer(request)

    guard = PaymentGuard(http=httpx.Client(transport=httpx.MockTransport(respond)), **kw)
    return guard, calls


def test_timeout_is_clamped_to_10s_and_a_smaller_value_is_kept(found):
    assert DEFAULT_HOSTED_TIMEOUT_S == 3.0
    assert MAX_HOSTED_TIMEOUT_S == 10.0
    assert clamp_hosted_timeout(60) == 10.0
    assert clamp_hosted_timeout(1.5) == 1.5
    assert clamp_hosted_timeout(float("inf")) == 3.0
    assert clamp_hosted_timeout(float("nan")) == 3.0
    assert clamp_hosted_timeout(-1) == 3.0

    url = found["latest_probe"]["url"]
    slow = Spy(lambda _request: httpx.Response(200, json=found))
    PaymentGuard(http=slow, timeout=60).before_payment_creation(ctx(url, req(found)))
    assert slow.timeouts == [10.0]

    quick = Spy(lambda _request: httpx.Response(200, json=found))
    PaymentGuard(http=quick, timeout=1.5).before_payment_creation(ctx(url, req(found)))
    assert quick.timeouts == [1.5]


def test_503_retry_after_opens_a_process_circuit_and_fail_open_stays_advice(found, monkeypatch):
    now = {"t": 1_000.0}
    monkeypatch.setattr("botsrated.payment_guard.time.monotonic", lambda: now["t"])
    url = found["latest_probe"]["url"]
    seen = []

    def answer(_request):
        return httpx.Response(503, headers={"retry-after": "30"}, json={"error": "overload"})

    guard, calls = _guard(answer, on_decision=seen.append)
    with guard.request(url):
        assert guard.before_payment_creation(ctx(url, req(found))) is None
    assert calls["n"] == 1
    decision = seen[0]
    assert decision.action == "allow" and decision.would_block is False
    assert any(r.code == "botsrated_unreachable" and r.effect == "info" and r.rule == "failOpen" for r in decision.reasons)
    assert decision.remote_decision is None
    assert "pass" not in decision.message.lower()

    other, calls2 = _guard(answer, on_decision=seen.append)
    with other.request(url):
        assert other.before_payment_creation(ctx(url, req(found))) is None
    assert calls2["n"] == 0
    assert seen[1].action == "allow" and seen[1].would_block is False
    assert any(r.code == "botsrated_unreachable" and r.effect == "info" for r in seen[1].reasons)

    now["t"] = 1_029.0
    with other.request("https://other.example/a"):
        other.before_payment_creation(ctx("https://other.example/a", req(found)))
    assert calls2["n"] == 0
    now["t"] = 1_030.0
    with other.request("https://other.example/a"):
        other.before_payment_creation(ctx("https://other.example/a", req(found)))
    assert calls2["n"] == 1

    reset_hosted_lookup_circuit()
    closed, closed_calls = _guard(answer, fail_open=False)
    blocked = closed.decide(ctx("https://third.example/a", req(found)))
    assert blocked.action == "block"
    assert any(r.code == "botsrated_unreachable" and r.effect == "block" for r in blocked.reasons)
    assert blocked.remote_decision is None
    later, later_calls = _guard(answer, fail_open=False)
    assert later.decide(ctx("https://fourth.example/a", req(found))).action == "block"
    assert closed_calls["n"] == 1 and later_calls["n"] == 0


def test_503_without_retry_after_waits_5s_and_429_skips_the_next_lookup(found, monkeypatch):
    now = {"t": 2_000.0}
    monkeypatch.setattr("botsrated.payment_guard.time.monotonic", lambda: now["t"])
    url = found["latest_probe"]["url"]

    def overload(_request):
        return httpx.Response(503, json={})

    guard, calls = _guard(overload)
    guard.before_payment_creation(ctx(url, req(found)))
    now["t"] = 2_004.9
    guard.before_payment_creation(ctx("https://other.example/a", req(found)))
    assert calls["n"] == 1
    now["t"] = 2_005.0
    guard.before_payment_creation(ctx("https://other.example/a", req(found)))
    assert calls["n"] == 2

    def limited(_request):
        return httpx.Response(429, headers={"retry-after": "12"}, json={})

    reset_hosted_lookup_circuit()
    again, first_calls = _guard(limited)
    again.before_payment_creation(ctx(url, req(found)))
    other, second_calls = _guard(limited)
    other.before_payment_creation(ctx("https://other.example/b", req(found)))
    assert first_calls["n"] == 1 and second_calls["n"] == 0


def test_http_date_retry_after_is_honored(found, monkeypatch):
    now = {"t": 3_000.0}
    monkeypatch.setattr("botsrated.payment_guard.time.monotonic", lambda: now["t"])
    when = datetime.now(timezone.utc) + timedelta(seconds=40)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    header = f"Thu, {when.day:02d} {months[when.month - 1]} {when.year:04d} {when.hour:02d}:{when.minute:02d}:{when.second:02d} GMT"
    url = found["latest_probe"]["url"]

    def answer(_request):
        return httpx.Response(503, headers={"retry-after": header}, json={})

    guard, calls = _guard(answer)
    guard.before_payment_creation(ctx(url, req(found)))
    now["t"] = 3_020.0
    guard.before_payment_creation(ctx("https://other.example/a", req(found)))
    assert calls["n"] == 1
    now["t"] = 3_050.0
    guard.before_payment_creation(ctx("https://other.example/a", req(found)))
    assert calls["n"] == 2


def test_policy_503_is_a_miss_and_does_not_invent_a_pass(found):
    url = found["latest_probe"]["url"]
    calls = {"policy": 0, "preflight": 0}

    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/policy/check"):
            calls["policy"] += 1
            return httpx.Response(503, headers={"retry-after": "20"}, json={"decision": "pass"})
        calls["preflight"] += 1
        return httpx.Response(200, json=found)

    seen = []
    guard = PaymentGuard(
        http=httpx.Client(transport=httpx.MockTransport(answer)),
        remote_policy={"token": TOKEN, "fail_mode": "open"},
        on_decision=seen.append,
    )
    with guard.request(url):
        first = guard.decide(ctx(url, req(found)))
    assert first.action == "allow" and first.remote_decision is None
    assert any(r.code == "remote_policy_unavailable" and r.effect == "info" and r.rule == "failMode" for r in first.reasons)
    assert calls == {"policy": 1, "preflight": 1}

    nxt = PaymentGuard(
        http=httpx.Client(transport=httpx.MockTransport(answer)),
        remote_policy={"token": TOKEN, "fail_mode": "open"},
        on_decision=seen.append,
    )
    with nxt.request(url):
        second = nxt.decide(ctx(url, req(found)))
    assert calls["policy"] == 1
    assert second.remote_decision is None and second.action == "allow"


def test_policy_503_on_another_origin_does_not_skip_botsrated_preflight(found):
    url = found["latest_probe"]["url"]
    preflight = {"n": 0}

    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.host == "policy.example":
            return httpx.Response(503, headers={"retry-after": "30"}, json={"decision": None})
        preflight["n"] += 1
        return httpx.Response(200, json=found)

    guard = PaymentGuard(
        http=httpx.Client(transport=httpx.MockTransport(answer)),
        remote_policy={"token": TOKEN, "fail_mode": "open", "base_url": "https://policy.example"},
    )
    guard.before_payment_creation(ctx(url, req(found)))
    guard.before_payment_creation(ctx("https://other.example/a", req(found)))
    assert preflight["n"] == 2


def test_404_and_500_do_not_open_the_circuit(found):
    url = found["latest_probe"]["url"]

    def missing(_request):
        return httpx.Response(404, json={"error": {"code": "host_not_covered"}})

    uncovered, calls = _guard(missing)
    uncovered.before_payment_creation(ctx(url, req(found)))
    uncovered.before_payment_creation(ctx("https://other.example/a", req(found)))
    assert calls["n"] == 2

    def broken(_request):
        return httpx.Response(500, json={})

    errored, more = _guard(broken)
    errored.before_payment_creation(ctx(url, req(found)))
    errored.before_payment_creation(ctx("https://other.example/a", req(found)))
    assert more["n"] == 2


def test_timeout_opens_the_circuit_for_the_next_lookup(found):
    url = found["latest_probe"]["url"]
    calls = {"n": 0}

    def answer(_request):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ReadTimeout("slow")
        return httpx.Response(200, json=found)

    guard = PaymentGuard(http=httpx.Client(transport=httpx.MockTransport(answer)))
    assert guard.before_payment_creation(ctx(url, req(found))) is None
    other = PaymentGuard(http=httpx.Client(transport=httpx.MockTransport(answer)))
    other.before_payment_creation(ctx("https://other.example/a", req(found)))
    assert calls["n"] == 1


def test_async_lookup_shares_the_circuit(found):
    url = found["latest_probe"]["url"]
    calls = {"n": 0}

    def answer(_request):
        calls["n"] += 1
        return httpx.Response(503, headers={"retry-after": "30"}, json={})

    guard = PaymentGuard(
        http=httpx.Client(transport=httpx.MockTransport(answer)),
        async_http=httpx.AsyncClient(transport=httpx.MockTransport(answer)),
    )
    assert guard.before_payment_creation(ctx(url, req(found))) is None
    asyncio.run(guard.abefore_payment_creation(ctx("https://other.example/a", req(found))))
    assert calls["n"] == 1


def test_preflight_sends_the_host_only(found):
    url = "https://blockrun.ai/api/v1/chat/completions?api_key=SECRET123"
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(503, headers={"retry-after": "5"}, json={})

    guard = PaymentGuard(http=httpx.Client(transport=httpx.MockTransport(answer)))
    with guard.request(url):
        guard.before_payment_creation(ctx(url, req(found)))
    assert len(seen) == 1
    assert str(seen[0].url) == "https://botsrated.com/v1/preflight?url=blockrun.ai"
    blob = str(seen[0].url) + str(dict(seen[0].headers))
    assert "SECRET123" not in blob and "/api/v1" not in blob
