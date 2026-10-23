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


def _botsrated_pr(extra_extra=None, extensions=None):
    from botsrated import BOTSRATED_PAY_TO

    return PaymentRequired.model_validate(
        {
            "x402Version": 2,
            "resource": {"url": "https://botsrated.com/v1/check?host=blockrun.ai"},
            "accepts": [
                {
                    "scheme": "exact",
                    "network": BASE_MAINNET,
                    "asset": BASE_USDC,
                    "amount": "1000",
                    "payTo": BOTSRATED_PAY_TO,
                    "maxTimeoutSeconds": 300,
                    "extra": {"name": "USD Coin", "version": "2", **(extra_extra or {})},
                }
            ],
            "extensions": extensions,
        }
    )


def test_permit2_botsrated_quote_never_reaches_rpc_signer():
    """A reserved BotsRated payment re-served with Permit2 + an ERC-20 approval extension is aborted
    before ExactEvmScheme runs, even with a transaction-capable signer."""
    from unittest.mock import patch

    from x402.mechanisms.evm.exact import ExactEvmScheme
    from x402.mechanisms.evm.signers import EthAccountSignerWithRPC

    from botsrated import BotsRatedClient

    bc = BotsRatedClient(budget_usd="0.01", paying_get=lambda u: None)
    bc.budget.reserve(1000)  # as during BotsRatedClient.check()
    signer = EthAccountSignerWithRPC(eth_account.Account.create(), rpc_url="http://127.0.0.1:9")
    c = x402ClientSync()
    c.register("eip155:*", ExactEvmScheme(signer=signer))
    c.on_before_payment_creation(PrePaymentGuard(bc).x402_hook)
    approval = {"erc20ApprovalGasSponsoring": {"info": {}, "schema": {}}}
    with (
        patch.object(signer, "sign_transaction") as sign_tx,
        patch.object(signer, "sign_typed_data", wraps=signer.sign_typed_data) as sign_typed,
    ):
        for pr in (
            _botsrated_pr({"assetTransferMethod": "permit2"}, approval),
            _botsrated_pr({"assetTransferMethod": "permit2"}),
            _botsrated_pr(None, approval),
        ):
            with pytest.raises(Exception, match="botsrated_payment"):
                c.create_payment_payload(pr)
        sign_tx.assert_not_called()
        sign_typed.assert_not_called()
        # The real quote shape (EIP-3009, bazaar discovery extension) still signs, without extensions.
        payload = c.create_payment_payload(_botsrated_pr(None, {"bazaar": {"info": {}}}))
        assert payload.accepted.amount == "1000" and not payload.extensions
        sign_tx.assert_not_called()


def test_x402_client_mode_signs_only_rebuilt_quote(check_402_b64):
    """BotsRatedClient(x402_client=...) signs a copy rebuilt from allowlisted fields and sends it itself."""
    import base64
    import json
    from unittest.mock import patch

    from x402.mechanisms.evm.exact import ExactEvmScheme
    from x402.mechanisms.evm.signers import EthAccountSignerWithRPC

    from botsrated import BotsRatedClient

    terms = json.loads(base64.b64decode(check_402_b64))
    terms["accepts"][0]["unknownField"] = "x"
    terms["resource"]["tags"] = ["x"]
    signer = EthAccountSignerWithRPC(eth_account.Account.create(), rpc_url="http://127.0.0.1:9")
    c = x402ClientSync()
    c.register("eip155:*", ExactEvmScheme(signer=signer))
    bc = BotsRatedClient(budget_usd="0.01", x402_client=c)
    c.on_before_payment_creation(PrePaymentGuard(bc).x402_hook)
    hdr = base64.b64encode(json.dumps(terms).encode()).decode()
    with (
        respx.mock(base_url="https://botsrated.com") as m,
        patch.object(c, "create_payment_payload", wraps=c.create_payment_payload) as create,
        patch.object(signer, "sign_transaction") as sign_tx,
    ):
        route = m.get("/v1/check").mock(
            side_effect=lambda req: respx.MockResponse(200, json={"host": "blockrun.ai"})
            if "payment-signature" in req.headers
            else respx.MockResponse(402, json={}, headers={"payment-required": hdr})
        )
        assert bc.check("blockrun.ai") == {"host": "blockrun.ai"}
        assert route.call_count == 2
        signed = create.call_args.args[0]
        assert signed.extensions is None
        assert signed.accepts[0].extra == terms["accepts"][0]["extra"]
        assert "unknownField" not in signed.accepts[0].model_dump(by_alias=True)
        sent = json.loads(base64.b64decode(route.calls[1].request.headers["payment-signature"]))
        assert sent["accepted"]["payTo"].lower() == terms["accepts"][0]["payTo"].lower()
        assert not sent.get("extensions")
        sign_tx.assert_not_called()
    assert bc.budget.spent_atomic == 1000 and bc.budget.pending_atomic == 0
