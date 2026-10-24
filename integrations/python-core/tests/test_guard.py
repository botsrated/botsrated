import httpx
import pytest
import respx

from botsrated import (
    BASE_MAINNET,
    BASE_USDC,
    BOTSRATED_PAY_TO,
    STRICT_GUARD_POLICY,
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
        # Only the host name is sent (0.2.0+).
        m.get("/v1/preflight", params={"url": "blockrun.ai"}).respond(200, json=found)
        m.get("/v1/preflight").respond(404, json=not_covered)
        m.get("/v1/check").respond(402, json={"x402Version": 2}, headers={"payment-required": check_402_b64})
        yield m


def test_host_of():
    assert host_of("https://Blockrun.ai/a?b=1") == "blockrun.ai"
    assert host_of("blockrun.ai") == "blockrun.ai"


def test_evaluate_matches(found):
    facts = facts_from(found, "blockrun.ai", "preflight")
    assert evaluate_payment(facts, req(found), found["latest_probe"]["url"]).action == "allow"


def test_evaluate_payto_mismatch_warns_by_default_blocks_with_explicit_policy(found):
    facts = facts_from(found, "blockrun.ai", "preflight")
    d = evaluate_payment(facts, req(found, payTo=DEAD), found["latest_probe"]["url"])
    assert d.action == "allow"
    assert d.reasons[0].code == "payto_not_observed" and d.reasons[0].effect == "warn"
    assert d.dispute_url == "https://botsrated.com/disputes"
    strict = evaluate_payment(facts, req(found, payTo=DEAD), None, STRICT_GUARD_POLICY)
    assert strict.action == "block"
    assert strict.summary().startswith("Payment stopped by your payment policy (rule: payto_not_observed). Fact: ")
    assert strict.summary().endswith("This is a measurement, not a finding about the seller. Dispute: https://botsrated.com/disputes")


def test_evaluate_other_network_not_compared(found):
    facts = facts_from(found, "blockrun.ai", "preflight")
    d = evaluate_payment(facts, req(found, payTo=DEAD, network="eip155:84532"), None)
    assert d.action == "allow" and d.reasons[0].code == "network_not_observed"


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


def test_paid_failure_keeps_amount_counted(mock_api):
    # A signed payment may settle before the call fails, so the budget is a hard ceiling.
    c = BotsRatedClient(budget_usd="0.001", paying_get=lambda u: httpx.Response(500))
    with pytest.raises(BotsRatedError) as e:
        c.check("blockrun.ai")
    assert e.value.code == "paid_call_failed"
    assert c.budget.spent_atomic == 1000 and c.budget.remaining_atomic == 0
    with pytest.raises(BotsRatedError) as e:
        c.check("blockrun.ai")
    assert e.value.code == "budget_exceeded"


def test_paid_exception_keeps_amount_counted(mock_api):
    def boom(url):
        raise TimeoutError("read")

    c = BotsRatedClient(budget_usd="0.01", paying_get=boom)
    with pytest.raises(TimeoutError):
        c.check("blockrun.ai")
    assert c.budget.spent_atomic == 1000


def test_paid_rejects_quote_with_any_foreign_option(check_402_b64):
    import base64
    import json

    terms = json.loads(base64.b64decode(check_402_b64))
    good = terms["accepts"][0]
    terms["accepts"] = [{**good, "amount": "500000", "payTo": DEAD}, good]
    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/check").respond(402, json={}, headers={"payment-required": base64.b64encode(json.dumps(terms).encode()).decode()})
        c = BotsRatedClient(budget_usd=1, paying_get=lambda u: pytest.fail("must not pay"))
        with pytest.raises(BotsRatedError) as e:
            c.check("blockrun.ai")
    assert e.value.code == "terms_rejected"


def test_listing_payto_alone_does_not_confirm(found):
    listed = "0x1111111111111111111111111111111111111111"
    body = {**found, "listing": {**(found.get("listing") or {}), "payTo": listed}}
    facts = facts_from(body, "blockrun.ai", "preflight")
    assert listed not in facts.known_pay_tos
    d = evaluate_payment(facts, req(found, payTo=listed), None, STRICT_GUARD_POLICY)
    assert d.action == "block" and d.reasons[0].code == "payto_not_observed"
    no_probe = {**body, "latest_probe": None, "measured": {}}
    facts = facts_from(no_probe, "blockrun.ai", "preflight")
    d = evaluate_payment(facts, req(found, payTo=listed), None)
    assert d.action == "allow" and d.reasons[0].code == "payto_listing_only"
    d = evaluate_payment(facts, req(found, payTo=DEAD), None, STRICT_GUARD_POLICY)
    assert d.action == "block"


def test_guard_paid_check_threshold(mock_api, sample_check, found):
    holder = {}

    def paying_get(url):
        # the guard sees this payment to BotsRated and must allow it because it is reserved
        r = {"scheme": "exact", "network": BASE_MAINNET, "asset": BASE_USDC, "payTo": BOTSRATED_PAY_TO, "amount": "1000", "maxTimeoutSeconds": 300}
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


def test_free_answer_on_paid_attempt_keeps_amount_counted(mock_api, free_check):
    # The payer may have signed before the answer, so the budget is not refunded.
    c = BotsRatedClient(budget_usd="0.005", paying_get=lambda u: httpx.Response(200, json=free_check))
    assert c.check("blockrun.ai")["charged"] is False
    assert c.budget.spent_atomic == 1000 and c.budget.pending_atomic == 0


def test_quota_used_up_message(mock_api):
    with pytest.raises(BotsRatedError, match="free daily quota used up"):
        BotsRatedClient().check("blockrun.ai")


def test_best_without_paid_lookups_does_not_mention_a_quota():
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(402, json={})))
    with pytest.raises(BotsRatedError) as e:
        BotsRatedClient(http=http).best("weather")
    assert e.value.code == "paid_disabled"
    assert "quota" not in str(e.value) and "x402_client" in str(e.value)


def test_refuses_old_check_price(check_402_b64):
    import base64
    import json as _json

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


def _hdr(terms):
    import base64
    import json as _json

    return base64.b64encode(_json.dumps(terms).encode()).decode()


@pytest.mark.parametrize(
    "mutate",
    [
        lambda t: t["accepts"][0]["extra"].update(assetTransferMethod="permit2"),
        lambda t: t["accepts"][0]["extra"].update(paymentFlow="x"),
        lambda t: t.update(extensions={**t.get("extensions", {}), "erc20ApprovalGasSponsoring": {}}),
        lambda t: t.update(extensions={"eip2612GasSponsoring": {}}),
        lambda t: t["accepts"][0].update(maxTimeoutSeconds=86400),
        lambda t: t["accepts"][0].update(maxTimeoutSeconds="300"),
        lambda t: t.update(x402Version=1),
    ],
)
def test_paid_rejects_permit2_extra_extensions_and_long_timeout(check_402_b64, mutate):
    import base64
    import json as _json

    terms = _json.loads(base64.b64decode(check_402_b64))
    mutate(terms)
    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/check").respond(402, json={}, headers={"payment-required": _hdr(terms)})
        c = BotsRatedClient(budget_usd=1, paying_get=lambda u: pytest.fail("must not pay"))
        with pytest.raises(BotsRatedError) as e:
            c.check("blockrun.ai")
    assert e.value.code == "terms_rejected"
    assert c.budget.pending_atomic == 0 and c.budget.spent_atomic == 0


def test_real_402_with_bazaar_extension_is_accepted(check_402_b64):
    import base64
    import json as _json

    terms = _json.loads(base64.b64decode(check_402_b64))
    assert terms["accepts"][0]["extra"] and set(terms.get("extensions") or {}) <= {"bazaar"}
    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/check").respond(402, json={}, headers={"payment-required": check_402_b64})
        c = BotsRatedClient(budget_usd=1, paying_get=lambda u: httpx.Response(200, json={"host": "blockrun.ai"}))
        assert c.check("blockrun.ai")["host"] == "blockrun.ai"


def test_paid_config_x402_client_or_paying_get():
    with pytest.raises(BotsRatedError):
        BotsRatedClient(budget_usd=1, paying_get=lambda u: None, x402_client=object())
    with pytest.raises(BotsRatedError):
        BotsRatedClient(x402_client=object())
    assert BotsRatedClient(budget_usd=1, x402_client=object()).paid_enabled


class _RecordingX402:
    def __init__(self):
        self.seen = []

    def create_payment_payload(self, pr):
        self.seen.append(pr)
        raise AssertionError("must not sign")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda t: (t["accepts"][0]["extra"].update(assetTransferMethod="permit2"), t.update(extensions={"erc20ApprovalGasSponsoring": {}})),
        lambda t: t["accepts"][0]["extra"].update(assetTransferMethod="permit2"),
        lambda t: t.update(extensions={**t.get("extensions", {}), "erc20ApprovalGasSponsoring": {}}),
        lambda t: t["accepts"][0].update(maxTimeoutSeconds=86400),
        lambda t: t.update(x402Version=1),
    ],
)
def test_x402_client_mode_rejects_permit2_before_signing(check_402_b64, mutate):
    import base64
    import json as _json

    terms = _json.loads(base64.b64decode(check_402_b64))
    mutate(terms)
    signer = _RecordingX402()
    with respx.mock(base_url="https://botsrated.com") as m:
        route = m.get("/v1/check").respond(402, json={}, headers={"payment-required": _hdr(terms)})
        c = BotsRatedClient(budget_usd=1, x402_client=signer)
        with pytest.raises(BotsRatedError) as e:
            c.check("blockrun.ai")
    assert e.value.code == "terms_rejected"
    assert signer.seen == [] and route.call_count == 1
    assert c.budget.pending_atomic == 0 and c.budget.spent_atomic == 0


def test_x402_client_mode_sign_failure_releases(check_402_b64):
    with respx.mock(base_url="https://botsrated.com") as m:
        route = m.get("/v1/check").respond(402, json={}, headers={"payment-required": check_402_b64})
        c = BotsRatedClient(budget_usd="0.001", x402_client=_RecordingX402())
        pytest.importorskip("x402")
        with pytest.raises(BotsRatedError) as e:
            c.check("blockrun.ai")
    assert e.value.code == "payment_not_created"
    assert route.call_count == 1 and c.budget.remaining_atomic == 1000


@pytest.mark.parametrize("bad", ["\u0661\u0660\u0660\u0660", "1\u00b2", "\uff11\uff10", "", " 1000", "1000\n", "-1", "1e3"])
def test_is_atomic_amount_ascii_digits_only(bad):
    from botsrated import is_atomic_amount

    assert is_atomic_amount("1000")
    assert not is_atomic_amount(bad)
    assert not is_atomic_amount(1000)


@pytest.mark.parametrize("amount", ["\u0661\u0660\u0660\u0660", "\u0967\u0966\u0966\u0966", "\uff11\uff10\uff10\uff10"])
def test_paid_rejects_non_ascii_digit_amount(check_402_b64, amount):
    """str.isdigit() and int() accept Arabic-Indic, Devanagari and full-width digits; the client must not."""
    import base64
    import json as _json

    terms = _json.loads(base64.b64decode(check_402_b64))
    terms["accepts"][0]["amount"] = amount
    assert int(amount) == 1000  # would have passed the old isdigit() + int() check
    c = BotsRatedClient(budget_usd=1, paying_get=lambda u: pytest.fail("must not pay"))
    assert c.signable_terms(terms) is None
    assert not c.acceptable_payment(terms["accepts"][0])
    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/check").respond(402, json={}, headers={"payment-required": _hdr(terms)})
        with pytest.raises(BotsRatedError) as e:
            c.check("blockrun.ai")
    assert e.value.code == "terms_rejected"
    assert c.budget.pending_atomic == 0 and c.budget.spent_atomic == 0


def test_decide_with_request_url_blocks_resource_url_of_other_host(mock_api, found):
    g = PrePaymentGuard()
    paid = found["latest_probe"]["url"]
    # The seller at evil.example claims to be blockrun.ai in its 402 resource.url: fail closed, even fail_open.
    d = g.decide(paid, req(found), request_url="https://evil.example/pay")
    assert d.action == "block" and d.reasons[0].code == "resource_url_mismatch"
    assert d.host == "evil.example" and "evil.example" in d.summary()
    assert not any(r.url.host == "botsrated.com" for r, _ in mock_api.calls)
    # Same host: allowed, and the lookup uses the request URL.
    d = g.decide(paid, req(found), request_url=paid)
    assert d.action == "allow" and d.host == "blockrun.ai"
    # No resource.url in the 402: the request URL alone is used.
    assert g.decide(None, req(found), request_url=paid).action == "allow"


def test_decide_with_request_url_looks_up_request_host(mock_api, found):
    g = PrePaymentGuard()
    d = g.decide(None, req(found), request_url="https://other.example/x")
    assert d.host == "other.example" and d.facts is not None and not d.facts.covered
    q = str(mock_api.calls.last.request.url)
    assert "other.example" in q and "blockrun.ai" not in q


def test_decide_request_url_claiming_botsrated_is_blocked(mock_api, found):
    d = PrePaymentGuard().decide("https://botsrated.com/v1/check?host=x", req(found), request_url="https://evil.example/")
    assert d.action == "block" and d.reasons[0].code == "resource_url_mismatch"


def test_paying_get_runs_inside_paying_request(check_402_b64):
    from botsrated import current_request_url

    seen = []

    def get(u):
        seen.append(current_request_url())
        return httpx.Response(200, json={"host": "blockrun.ai"})

    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/check").respond(402, json={}, headers={"payment-required": check_402_b64})
        BotsRatedClient(budget_usd=1, paying_get=get).check("blockrun.ai")
    assert seen == ["https://botsrated.com/v1/check?host=blockrun.ai"]
    assert current_request_url() is None


def test_host_of_normalizes_idna_and_trailing_dot():
    assert host_of("https://Bücher.Example./x") == "xn--bcher-kva.example"
    assert host_of("xn--bcher-kva.example") == "xn--bcher-kva.example"
    assert host_of("blockrun.ai.") == "blockrun.ai"
    for bad in ("https://./", "https://a..b/", "https://" + "a" * 64 + ".com/"):
        with pytest.raises(BotsRatedError):
            host_of(bad)


def test_host_of_reads_backslashes_as_slashes_like_whatwg():
    # Same answers as the TypeScript hostOf (WHATWG URL): a backslash ends the authority in http(s) URLs.
    assert host_of("https://evil.example\\@good.example/x") == "evil.example"
    assert host_of("https://evil.example\\path") == "evil.example"
    assert host_of("evil.example\\@good.example") == "evil.example"


def test_request_url_host_compare_is_normalized(mock_api, found):
    g = PrePaymentGuard()
    # Trailing dot / case / IDNA spellings of the same host are not a mismatch.
    d = g.decide("https://BLOCKRUN.AI./api/v1/chat/completions", req(found), request_url=found["latest_probe"]["url"])
    assert d.action == "allow"
    d = g.decide("https://bücher.example/a", req(found), request_url="https://xn--bcher-kva.example/a")
    assert not any(r.code == "resource_url_mismatch" for r in d.reasons)
    # A look-alike IDNA host is a different host.
    d = g.decide("https://blоckrun.ai/a", req(found), request_url=found["latest_probe"]["url"])  # Cyrillic o
    assert d.action == "block" and d.reasons[0].code == "resource_url_mismatch"


def test_request_url_tolerates_apex_www_redirect_only(mock_api, found):
    g = PrePaymentGuard()
    paid = found["latest_probe"]["url"]
    assert g.decide("https://www.blockrun.ai/api/v1/chat/completions", req(found), request_url=paid).action == "allow"
    assert g.decide(paid, req(found), request_url="https://www.blockrun.ai/api/v1/chat/completions").action == "allow"
    for other in ("https://api.blockrun.ai/x", "https://www.evil.example/x", "https://wwwblockrun.ai/x", "https://www.www.blockrun.ai/x"):
        d = g.decide(other, req(found), request_url=paid)
        assert d.action == "block" and d.reasons[0].code == "resource_url_mismatch", other


def test_resource_url_odd_spellings_cannot_skip_the_check(mock_api, found):
    g = PrePaymentGuard()
    for claimed in ("  https://evil.example/x", "https:evil.example", "https:///evil.example"):
        d = g.decide(claimed, req(found), request_url=found["latest_probe"]["url"])
        assert d.action == "block" and d.reasons[0].code == "resource_url_mismatch", claimed
