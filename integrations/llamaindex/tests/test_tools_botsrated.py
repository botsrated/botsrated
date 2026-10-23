import json
from pathlib import Path

import httpx
import pytest
import respx
from botsrated import BotsRatedClient
from llama_index.core.tools.tool_spec.base import BaseToolSpec

from llama_index.tools.botsrated import BotsRatedToolSpec

FX = Path(__file__).resolve().parents[2] / "fixtures"
FOUND = json.loads((FX / "preflight-found.json").read_text())
NOT_COVERED = json.loads((FX / "preflight-not-covered.json").read_text())
B64 = (FX / "check-402-payment-required.b64").read_text().strip()
SAMPLE = json.loads((FX / "sample-check.json").read_text())


@pytest.fixture
def api():
    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as m:
        m.get("/v1/preflight", params={"url": FOUND["latest_probe"]["url"]}).respond(200, json=FOUND)
        m.get("/v1/preflight").respond(404, json=NOT_COVERED)
        m.get("/v1/check").respond(402, headers={"payment-required": B64}, json={})
        yield m


def test_class():
    assert BaseToolSpec.__name__ in [b.__name__ for b in BotsRatedToolSpec.__mro__]


def test_free_only_by_default():
    assert [t.metadata.name for t in BotsRatedToolSpec().to_tool_list()] == ["preflight"]


def test_preflight_decisions(api):
    spec = BotsRatedToolSpec()
    url = FOUND["latest_probe"]["url"]
    assert spec.preflight(url, pay_to=FOUND["latest_probe"]["live_payTo"])["decision"]["action"] == "allow"
    assert spec.preflight(url, pay_to="0x000000000000000000000000000000000000dEaD")["decision"]["action"] == "block"
    assert spec.preflight("x.example")["covered"] is False


def test_paid_check_budget(api):
    spec = BotsRatedToolSpec(BotsRatedClient(budget_usd="0.001", paying_get=lambda u: httpx.Response(200, json=SAMPLE)))
    names = [t.metadata.name for t in spec.to_tool_list()]
    assert names == ["preflight", "paid_check"]
    assert spec.paid_check("blockrun.ai")["remaining_usd"] == 0.0
    assert spec.paid_check("blockrun.ai")["error"] == "budget_exceeded"


def test_paid_check_free_quota_answer():
    free = json.loads((FX / "check-free-quota.json").read_text())
    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/check").respond(200, json=free)
        spec = BotsRatedToolSpec(BotsRatedClient(budget_usd="0.001", paying_get=lambda u: pytest.fail("must not pay")))
        out = spec.paid_check("www.ax1.vc")
        assert out["charged"] is False and out["remaining_usd"] == 0.001
