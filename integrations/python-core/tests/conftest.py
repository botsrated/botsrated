import json
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _reset_hosted_lookup_circuit():
    """Each test starts with the in-process hosted-lookup circuit closed."""
    from botsrated.payment_guard import reset_hosted_lookup_circuit

    reset_hosted_lookup_circuit()
    yield
    reset_hosted_lookup_circuit()


FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture
def found() -> dict:
    return json.loads((FIXTURES / "preflight-found.json").read_text())


@pytest.fixture
def not_covered() -> dict:
    return json.loads((FIXTURES / "preflight-not-covered.json").read_text())


@pytest.fixture
def check_402_b64() -> str:
    return (FIXTURES / "check-402-payment-required.b64").read_text().strip()


@pytest.fixture
def sample_check() -> dict:
    return json.loads((FIXTURES / "sample-check.json").read_text())


@pytest.fixture
def free_check() -> dict:
    """Real 200 served from BotsRated's free daily quota (charged: false)."""
    return json.loads((FIXTURES / "check-free-quota.json").read_text())
