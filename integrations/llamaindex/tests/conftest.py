"""Each test starts with the in-process hosted-lookup circuit closed."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _reset_hosted_lookup_circuit():
    from botsrated.payment_guard import reset_hosted_lookup_circuit

    reset_hosted_lookup_circuit()
    yield
    reset_hosted_lookup_circuit()
