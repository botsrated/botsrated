import httpx
import pytest
import respx

from botsrated import (
    BASE_MAINNET,
    BASE_USDC,
    BOTSRATED_PAY_TO,
    BotsRatedClient,
    BotsRatedError,
    GuardPolicy,
    PrePaymentGuard,
    evaluate_payment,
    facts_from,
    host_of,
)

DEAD = "0x000000000000000000000000000000000000dEaD"


def req(found, **over):
    r = {
        "scheme": "exact",
        "network": BASE_MAINNET,
        "asset": BASE_USDC,
        "payTo": found["latest_probe"]["live_payTo"],
        "amount": found["latest_probe"]["live_amount"],
    }
    r.update(over)
    return r


@pytest.fixture
def mock_api(found, not_covered, check_402_b64):
    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as m:
        m.get("/v1/preflight", params={"url": found["latest_probe"]["url"]}).respond(200, json=found)
        m.get("/v1/preflight").respond(404, json=not_covered)
        m.get("/v1/check").respond(402, json={"x402Version": 2}, headers={"payment-required": check_402_b64})
        yield m


def test_host_of():
    assert host_of("https://Blockrun.ai/a?b=1") == "blockrun.ai"
    assert host_of("blockrun.ai") == "blockrun.ai"


def test_evaluate_matches(found):
    facts = facts_from(found, "blockrun.ai", "preflight")
    assert evaluate_payment(facts, req(found), found["latest_probe"]["url"]).action == "allow"


def test_evaluate_payto_mismatch_blocks_by_default(found):
    facts = facts_from(found, "blockrun.ai", "preflight")
    d = evaluate_payment(facts, req(found, payTo=DEAD), found["latest_probe"]["url"])
    assert d.action == "block"
    assert d.reasons[0].code == "payto_mismatch"
    assert evaluate_payment(facts, req(found, payTo=DEAD), None, GuardPolicy(pay_to_mismatch="warn")).action == "allow"


def test_evaluate_other_network_not_compared(found):
    facts = facts_from(found, "blockrun.ai", "preflight")
    d = evaluate_payment(facts, req(found, payTo=DEAD, network="eip155:84532"), None)
    assert d.action == "allow" and d.reasons[0].code == "network_not_measured"


def test_price_above_observed_same_route_only(found):
    facts = facts_from(found, "blockrun.ai", "preflight")
    same = evaluate_payment(facts, req(found, amount="999999"), found["latest_probe"]["url"])
    assert same.action == "allow" and "price_above_observed" in [r.code for r in same.reasons]
    other = evaluate_payment(facts, req(found, amount="999999"), "https://blockrun.ai/api/v1/images/generate")
    assert "price_above_observed" not in [r.code for r in other.reasons]
    assert evaluate_payment(facts, req(found, amount="999999"), found["latest_probe"]["url"], GuardPolicy(price_above_observed="block")).action == "block"


def test_min_valid_402_rate_needs_3_probes(found):
    facts = facts_from(found, "blockrun.ai", "preflight")
    facts.valid_402_rate, facts.recent_probes = 0.2, 5
    assert evaluate_payment(facts, req(found), None, GuardPolicy(min_valid_402_rate=0.9)).action == "block"
    facts.recent_probes = 2
    assert evaluate_payment(facts, req(found), None, GuardPolicy(min_valid_402_rate=0.9)).action == "allow"


def test_guard_free_by_default_and_cached(mock_api, found):
    g = PrePaymentGuard()
    url = found["latest_probe"]["url"]
    assert g.decide(url, req(found)).action == "allow"
    assert g.decide("https://blockrun.ai/other", req(found)).action == "allow"
    assert mock_api.calls.call_count == 1
    assert "/v1/preflight" in str(mock_api.calls[0].request.url)


def test_guard_not_covered(mock_api, found):
    assert PrePaymentGuard().decide("https://x.example/a", req(found)).action == "allow"
    assert PrePaymentGuard(policy=GuardPolicy(not_covered="block")).decide("https://x.example/a", req(found)).action == "block"


def test_guard_fail_open_and_closed(found):
    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/preflight").mock(side_effect=httpx.ConnectError("down"))
        assert PrePaymentGuard().decide(found["latest_probe"]["url"], req(found)).action == "allow"
        assert PrePaymentGuard(fail_open=False).decide(found["latest_probe"]["url"], req(found)).action == "block"


def test_guard_blocks_unreserved_botsrated_payment(mock_api):
    d = PrePaymentGuard().decide(
        "https://botsrated.com/v1/check?host=blockrun.ai",
        {"scheme": "exact", "network": BASE_MAINNET, "asset": BASE_USDC, "payTo": BOTSRATED_PAY_TO, "amount": "2000"},
    )
    assert d.action == "block" and d.reasons[0].code == "botsrated_payment_not_reserved"


def test_paid_disabled_by_default(mock_api):
    with pytest.raises(BotsRatedError) as e:
        BotsRatedClient().check("blockrun.ai")
    assert e.value.code == "paid_disabled"


def test_paid_config_needs_both():
    with pytest.raises(BotsRatedError):
        BotsRatedClient(budget_usd=1)


def test_paid_check_charges_budget(mock_api, sample_check):
    calls = []

    def paying_get(url):
        calls.append(url)
        return httpx.Response(200, json=sample_check)

    c = BotsRatedClient(budget_usd="0.005", paying_get=paying_get)
    assert c.check("https://blockrun.ai/x")["host"] == "blockrun.ai"
    assert calls == ["https://botsrated.com/v1/check?host=blockrun.ai"]
    assert c.budget.spent_atomic == 1000 and c.budget.remaining_atomic == 4000


def test_paid_refuses_over_budget_before_paying(mock_api):
    c = BotsRatedClient(budget_usd="0.0005", paying_get=lambda u: pytest.fail("must not pay"))
    with pytest.raises(BotsRatedError) as e:
        c.check("blockrun.ai")
    assert e.value.code == "budget_exceeded"


def test_paid_refuses_other_payto(mock_api):
    c = BotsRatedClient(budget_usd=1, paying_get=lambda u: pytest.fail("must not pay"), expected_pay_to=DEAD)
    with pytest.raises(BotsRatedError) as e:
        c.check("blockrun.ai")
    assert e.value.code == "terms_rejected"


def test_paid_failure_releases(mock_api):
    c = BotsRatedClient(budget_usd="0.01", paying_get=lambda u: httpx.Response(500))
    with pytest.raises(BotsRatedError):
        c.check("blockrun.ai")
    assert c.budget.spent_atomic == 0 and c.budget.remaining_atomic == 10000


def test_guard_paid_check_threshold(mock_api, sample_check, found):
    holder = {}

    def paying_get(url):
        # the guard sees this payment to BotsRated and must allow it because it is reserved
        r = {"scheme": "exact", "network": BASE_MAINNET, "asset": BASE_USDC, "payTo": BOTSRATED_PAY_TO, "amount": "1000"}
        assert holder["g"].decide(url, r).action == "allow"
        return httpx.Response(200, json=sample_check)

    c = BotsRatedClient(budget_usd="0.01", paying_get=paying_get)
    holder["g"] = g = PrePaymentGuard(c, paid_check_at_or_above_usd=0.5)
    d = g.decide(found["latest_probe"]["url"], req(found, amount="1000000"))
    assert d.facts.source == "check" and c.budget.spent_atomic == 1000
    # below threshold: preflight only
    assert g.decide(found["latest_probe"]["url"], req(found)).facts.source == "preflight"


def test_free_quota_answer_is_not_charged(found, free_check):
    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as m:
        m.get("/v1/check").respond(200, json=free_check)
        c = BotsRatedClient(budget_usd="0.005", paying_get=lambda u: pytest.fail("must not pay"))
        out = c.check("www.ax1.vc")
        assert out["charged"] is False and out["free_quota"]["limit"] == 100
        assert c.budget.spent_atomic == 0 and c.budget.remaining_atomic == 5000
        assert c.last_free_quota["remaining"] == out["free_quota"]["remaining"]
        # works without a paid config while the quota lasts
        assert BotsRatedClient().check("www.ax1.vc")["charged"] is False


def test_free_answer_on_paid_attempt_releases(mock_api, free_check):
    c = BotsRatedClient(budget_usd="0.005", paying_get=lambda u: httpx.Response(200, json=free_check))
    assert c.check("blockrun.ai")["charged"] is False
    assert c.budget.spent_atomic == 0 and c.budget.pending_atomic == 0


def test_quota_used_up_message(mock_api):
    with pytest.raises(BotsRatedError, match="free daily quota used up"):
        BotsRatedClient().check("blockrun.ai")


def test_refuses_old_check_price(check_402_b64):
    import base64, json as _json

    terms = _json.loads(base64.b64decode(check_402_b64))
    for a in terms["accepts"]:
        a["amount"] = "2000"
    hdr = base64.b64encode(_json.dumps(terms).encode()).decode()
    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/check").respond(402, json={}, headers={"payment-required": hdr})
        c = BotsRatedClient(budget_usd=1, paying_get=lambda u: pytest.fail("must not pay"))
        with pytest.raises(BotsRatedError) as e:
            c.check("blockrun.ai")
        assert e.value.code == "terms_rejected"


def test_guard_check_uses_free_quota_without_paid(found, not_covered, free_check):
    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as m:
        m.get("/v1/preflight").respond(200, json=found)
        m.get("/v1/check").respond(200, json=free_check)
        g = PrePaymentGuard(BotsRatedClient(), paid_check_at_or_above_usd=0.5)
        assert g.decide(found["latest_probe"]["url"], req(found, amount="1000000")).facts.source == "check"
