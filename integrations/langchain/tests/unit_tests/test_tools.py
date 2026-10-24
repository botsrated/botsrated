import json
from pathlib import Path

import httpx
import pytest
import respx
from botsrated import BotsRatedClient

from langchain_botsrated import (
    BotsRatedCheckTool,
    BotsRatedPreflightTool,
    botsrated_tools,
)

FX = Path(__file__).resolve().parents[3] / "fixtures"
FOUND = json.loads((FX / "preflight-found.json").read_text())
NOT_COVERED = json.loads((FX / "preflight-not-covered.json").read_text())
B64 = (FX / "check-402-payment-required.b64").read_text().strip()
SAMPLE = json.loads((FX / "sample-check.json").read_text())


@pytest.fixture
def api():
    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as m:
        # botsrated sends only the host name (0.2+; older versions sent the URL)
        m.get("/v1/preflight", params={"url": FOUND["host"]}).respond(200, json=FOUND)
        m.get("/v1/preflight", params={"url": FOUND["latest_probe"]["url"]}).respond(200, json=FOUND)
        m.get("/v1/preflight").respond(404, json=NOT_COVERED)
        m.get("/v1/check").respond(402, headers={"payment-required": B64}, json={})
        yield m


def test_preflight_allow(api):
    out = json.loads(BotsRatedPreflightTool().invoke({"url": FOUND["latest_probe"]["url"], "pay_to": FOUND["latest_probe"]["live_payTo"]}))
    assert out["covered"] and out["decision"]["action"] == "allow"
    assert out["last_probe"]["receipt_url"].startswith("https://botsrated.com/receipt/")


def test_preflight_block_unseen_payto(api):
    """The tool keeps blocking an unobserved payTo on every botsrated version (0.2 made it advice-only by default)."""
    out = json.loads(BotsRatedPreflightTool().invoke({"url": FOUND["latest_probe"]["url"], "pay_to": "0x000000000000000000000000000000000000dEaD"}))
    assert out["decision"]["action"] == "block"
    r = out["decision"]["reasons"][0]
    # Reason code: payto_not_observed since botsrated 0.2, payto_mismatch in 0.1.x.
    assert r["code"] in {"payto_not_observed", "payto_mismatch"} and r["effect"] == "block"


def test_preflight_not_covered(api):
    assert json.loads(BotsRatedPreflightTool().invoke({"url": "x.example"}))["covered"] is False


def test_tools_factory_free_by_default(api):
    assert [t.name for t in botsrated_tools()] == ["botsrated_preflight"]


def test_paid_tool_budget(api):
    client = BotsRatedClient(budget_usd="0.001", paying_get=lambda u: httpx.Response(200, json=SAMPLE))
    tools = botsrated_tools(client)
    assert [t.name for t in tools] == ["botsrated_preflight", "botsrated_paid_check"]
    first = json.loads(tools[1].invoke({"host": "blockrun.ai"}))
    assert first["remaining_usd"] == 0.0 and first["charged"] is True
    second = json.loads(tools[1].invoke({"host": "blockrun.ai"}))
    assert second["error"] == "budget_exceeded"


def test_paid_tool_disabled_client(api):
    out = json.loads(BotsRatedCheckTool(client=BotsRatedClient()).invoke({"host": "blockrun.ai"}))
    assert out["error"] == "paid_disabled"


def test_paid_tool_free_quota_answer():
    free = json.loads((FX / "check-free-quota.json").read_text())
    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/check").respond(200, json=free)
        client = BotsRatedClient(budget_usd="0.001", paying_get=lambda u: pytest.fail("must not pay"))
        out = json.loads(botsrated_tools(client)[1].invoke({"host": "www.ax1.vc"}))
        assert out["charged"] is False and out["remaining_usd"] == 0.001


class _NoSign:
    def create_payment_payload(self, pr):
        pytest.fail("must not sign")


def test_paid_tool_refuses_permit2_quote_before_signing():
    import base64

    terms = json.loads(base64.b64decode(B64))
    terms["accepts"][0]["extra"]["assetTransferMethod"] = "permit2"
    terms["extensions"] = {"erc20ApprovalGasSponsoring": {"info": {}, "schema": {}}}
    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/check").respond(402, json={}, headers={"payment-required": base64.b64encode(json.dumps(terms).encode()).decode()})
        client = BotsRatedClient(budget_usd="0.001", x402_client=_NoSign())
        out = json.loads(botsrated_tools(client)[1].invoke({"host": "blockrun.ai"}))
    assert out["error"] == "terms_rejected" and client.budget.remaining_atomic == 1000
