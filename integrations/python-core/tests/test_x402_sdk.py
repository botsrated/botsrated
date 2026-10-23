"""Real x402 Python SDK hook (x402ClientSync + ExactEvmScheme). Throwaway key; nothing is sent."""

import pytest
import respx

x402 = pytest.importorskip("x402")
eth_account = pytest.importorskip("eth_account")

from x402 import x402ClientSync  # noqa: E402
from x402.schemas import PaymentRequired  # noqa: E402

from botsrated import BASE_MAINNET, BASE_USDC, PrePaymentGuard  # noqa: E402


def _client(guard):
    from x402.mechanisms.evm import EthAccountSigner
    from x402.mechanisms.evm.exact import ExactEvmScheme

    c = x402ClientSync()
    c.register("eip155:*", ExactEvmScheme(signer=EthAccountSigner(eth_account.Account.create())))
    c.on_before_payment_creation(guard.x402_hook)
    return c


def _pr(found, pay_to):
    return PaymentRequired.model_validate(
        {
            "x402Version": 2,
            "resource": {"url": found["latest_probe"]["url"]},
            "accepts": [
                {
                    "scheme": "exact",
                    "network": BASE_MAINNET,
                    "asset": BASE_USDC,
                    "amount": found["latest_probe"]["live_amount"],
                    "payTo": pay_to,
                    "maxTimeoutSeconds": 60,
                    "extra": {"name": "USD Coin", "version": "2"},
                }
            ],
        }
    )


def test_hook_allows_and_blocks(found):
    with respx.mock(base_url="https://botsrated.com") as m:
        m.get("/v1/preflight").respond(200, json=found)
        client = _client(PrePaymentGuard())
        payload = client.create_payment_payload(_pr(found, found["latest_probe"]["live_payTo"]))
        assert payload.accepted.pay_to.lower() == found["latest_probe"]["live_payTo"].lower()
        with pytest.raises(Exception, match="payto_mismatch"):
            client.create_payment_payload(_pr(found, "0x000000000000000000000000000000000000dEaD"))
