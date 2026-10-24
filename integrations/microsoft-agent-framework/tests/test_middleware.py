"""Offline tests: the BotsRated guard is replaced by a recorder, so no network is used."""

from importlib.metadata import version as _botsrated_version

import pytest
from agent_framework import Agent
from botsrated import Decision, GuardPolicy, PrePaymentGuard, Reason, SellerFacts, evaluate_payment
from conftest import ScriptedModel, results

from agent_framework_botsrated import (
    DECISION_METADATA_KEY,
    BotsRatedPaymentBlocked,
    BotsRatedPaymentMiddleware,
    PaymentQuote,
    default_quote_extractor,
)

SELLER = "https://seller.example/api"
GOOD = "0x1111111111111111111111111111111111111111"
BAD = "0x2222222222222222222222222222222222222222"


# Reason code for a payTo BotsRated never observed: payto_not_observed since botsrated 0.2, payto_mismatch before.
_BOTSRATED_MINOR = tuple(int(x) for x in _botsrated_version("botsrated").split(".")[:2])
PAYTO_CODE = "payto_not_observed" if _BOTSRATED_MINOR >= (0, 2) else "payto_mismatch"


class RecordingGuard(PrePaymentGuard):
    """Uses the real botsrated policy on fixed facts instead of calling the API."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[tuple[str | None, dict]] = []
        self.facts = SellerFacts(covered=True, host="seller.example", source="preflight", known_pay_tos=[GOOD])

    def decide(self, resource_url, requirements):  # type: ignore[override]
        self.calls.append((resource_url, dict(requirements)))
        # Blocking on an unobserved payTo is opt-in since botsrated 0.2 (advice only by default).
        return evaluate_payment(self.facts, requirements, resource_url, GuardPolicy(pay_to_mismatch="block"))


paid: list[str] = []


def pay_x402(url: str, pay_to: str, amount: str, network: str = "eip155:8453") -> str:
    """Pay an x402 seller (test stub)."""
    paid.append(pay_to)
    return f"PAID {pay_to}"


def get_weather(city: str) -> str:
    """Get the weather."""
    return f"Sunny in {city}"


@pytest.fixture(autouse=True)
def _reset() -> None:
    paid.clear()


async def test_blocks_unknown_pay_to_and_allows_observed_one() -> None:
    guard = RecordingGuard()
    seen: list[Decision] = []
    guard.on_decision = seen.append
    model = ScriptedModel(
        [
            ("bad", "pay_x402", {"url": SELLER, "pay_to": BAD, "amount": "2000"}),
            ("good", "pay_x402", {"url": SELLER, "pay_to": GOOD, "amount": "2000"}),
        ]
    )
    agent = Agent(client=model, tools=[pay_x402], middleware=[BotsRatedPaymentMiddleware(["pay_x402"], guard=guard)])
    out = results(await agent.run("pay"))
    assert paid == [GOOD]  # the blocked call never ran
    assert "was not executed" in str(out["bad"]) and PAYTO_CODE in str(out["bad"])
    assert out["good"] == f"PAID {GOOD}"
    assert [d.action for d in seen] == ["block", "allow"]
    assert guard.calls[0] == (SELLER, {"scheme": "exact", "network": "eip155:8453", "payTo": BAD, "amount": "2000"})


async def test_other_tools_are_not_checked() -> None:
    guard = RecordingGuard()
    model = ScriptedModel([("w", "get_weather", {"city": "Paris"})])
    agent = Agent(client=model, tools=[get_weather], middleware=[BotsRatedPaymentMiddleware(["pay_x402"], guard=guard)])
    out = results(await agent.run("weather"))
    assert out["w"] == "Sunny in Paris"
    assert guard.calls == []


async def test_unreadable_quote_fails_closed() -> None:
    guard = RecordingGuard()

    def pay_somehow(target: str) -> str:
        """A payment tool whose arguments carry no quote."""
        paid.append(target)
        return "PAID"

    model = ScriptedModel([("x", "pay_somehow", {"target": SELLER})])
    agent = Agent(
        client=model, tools=[pay_somehow], middleware=[BotsRatedPaymentMiddleware(["pay_somehow"], guard=guard)]
    )
    out = results(await agent.run("pay"))
    assert paid == [] and guard.calls == []
    assert "quote_unreadable" in str(out["x"])


async def test_custom_extractor_and_metadata() -> None:
    guard = RecordingGuard()
    captured: dict = {}

    def extract(args):  # type: ignore[no-untyped-def]
        return PaymentQuote(url=args["endpoint"], pay_to=args["recipient"], amount=str(args["atomic"]))

    from agent_framework import FunctionMiddleware

    class Capture(FunctionMiddleware):
        async def process(self, context, call_next):  # type: ignore[no-untyped-def]
            await call_next()
            captured.update(context.metadata)

    def buy(endpoint: str, recipient: str, atomic: int) -> str:
        """Buy."""
        paid.append(recipient)
        return "PAID"

    model = ScriptedModel([("c", "buy", {"endpoint": SELLER, "recipient": GOOD, "atomic": 5})])
    agent = Agent(
        client=model,
        tools=[buy],
        middleware=[Capture(), BotsRatedPaymentMiddleware({"buy": extract}, guard=guard)],
    )
    await agent.run("buy")
    assert paid == [GOOD]
    assert captured[DECISION_METADATA_KEY].action == "allow"


async def test_on_block_raise_ends_the_run() -> None:
    guard = RecordingGuard()
    model = ScriptedModel([("bad", "pay_x402", {"url": SELLER, "pay_to": BAD, "amount": "1"})])
    agent = Agent(
        client=model,
        tools=[pay_x402],
        middleware=[BotsRatedPaymentMiddleware(["pay_x402"], guard=guard, on_block="raise")],
    )
    with pytest.raises(BotsRatedPaymentBlocked) as info:
        await agent.run("pay")
    assert info.value.decision.reasons[0].code == PAYTO_CODE
    assert paid == []


async def test_unreachable_botsrated_follows_guard_fail_open_setting() -> None:
    class Down(PrePaymentGuard):
        def decide(self, resource_url, requirements):  # type: ignore[override]
            eff = "info" if self.fail_open else "block"
            return Decision(
                "allow" if self.fail_open else "block", "seller.example", [Reason("botsrated_unavailable", "down", eff)]
            )

    for fail_open, expected in ((True, [GOOD]), (False, [])):
        paid.clear()
        model = ScriptedModel([("p", "pay_x402", {"url": SELLER, "pay_to": GOOD, "amount": "1"})])
        mw = BotsRatedPaymentMiddleware(["pay_x402"], guard=Down(fail_open=fail_open))
        await Agent(client=model, tools=[pay_x402], middleware=[mw]).run("pay")
        assert paid == expected


@pytest.mark.parametrize(
    "args",
    [
        {"url": SELLER, "pay_to": GOOD},
        {"url": SELLER, "pay_to": GOOD, "amount": "1.5"},
        {"url": SELLER, "pay_to": GOOD, "amount": True},
        {"url": SELLER, "pay_to": GOOD, "amount": "\u0661\u0660\u0660\u0660"},
        {"url": SELLER, "pay_to": GOOD, "amount": "\uff11\uff10"},
        {"url": SELLER, "pay_to": GOOD, "amount": "1\u00b2"},
        {"pay_to": GOOD, "amount": "1"},
        {"url": 5, "pay_to": GOOD, "amount": "1"},
    ],
)
def test_default_extractor_rejects_incomplete_quotes(args: dict) -> None:
    with pytest.raises(ValueError):
        default_quote_extractor(args)


def test_default_extractor_reads_camel_case() -> None:
    q = default_quote_extractor({"url": SELLER, "payTo": GOOD, "amount": 7, "network": "eip155:84532"})
    assert q.requirements() == {"scheme": "exact", "network": "eip155:84532", "payTo": GOOD, "amount": "7"}


def test_needs_a_payment_tool() -> None:
    with pytest.raises(ValueError):
        BotsRatedPaymentMiddleware([])


def test_version_comes_from_package_metadata() -> None:
    from importlib.metadata import version

    import agent_framework_botsrated

    assert agent_framework_botsrated.__version__ == version("agent-framework-botsrated") == "0.1.3"


def test_default_guard_blocks_an_unobserved_pay_to() -> None:
    """The middleware's own default guard keeps blocking an unobserved payTo (botsrated 0.2 made it advice-only)."""
    mw = BotsRatedPaymentMiddleware(["pay_x402"])
    assert mw.guard.policy.pay_to_mismatch == "block"
    facts = SellerFacts(covered=True, host="seller.example", source="preflight", known_pay_tos=[GOOD])
    req = {"scheme": "exact", "network": "eip155:8453", "payTo": BAD, "amount": "1"}
    d = evaluate_payment(facts, req, SELLER, mw.guard.policy)
    assert d.action == "block" and d.reasons[0].code == PAYTO_CODE
