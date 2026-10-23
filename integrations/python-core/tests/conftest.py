import json
from pathlib import Path

import pytest

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
