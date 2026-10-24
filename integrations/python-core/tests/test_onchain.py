"""Read-only on-chain payment state: settled / unknown / expired_unsettled only."""

from __future__ import annotations

import json

import pytest

from botsrated import (
    DEFAULT_BASE_RPCS,
    PaymentGuard,
    PaymentRecord,
    check_payment_state,
)
from botsrated.onchain import (
    AUTHORIZATION_STATE_SELECTOR,
    AUTHORIZATION_USED_TOPIC,
    TRANSFER_TOPIC,
    _reset_chain_cache,
)

USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
FROM = "0x" + "a" * 40
PAYTO = "0x" + "b" * 40
NONCE = "0x" + "1" * 64
TX = "0x" + "c" * 64
NOW = 1_800_000_000
RPCS = ["https://rpc-one.example", "https://rpc-two.example"]
READ = {"eth_chainId", "eth_call", "eth_getBlockByNumber", "eth_getLogs", "eth_getTransactionReceipt"}


def pad(a: str) -> str:
    return "0x" + a[2:].lower().rjust(64, "0")


def word(n: int) -> str:
    return "0x" + format(n, "064x")


def rec(**o) -> PaymentRecord:
    base = {"network": "eip155:8453", "asset": USDC, "from_": FROM, "pay_to": PAYTO, "amount": "2000", "nonce": NONCE, "valid_before": NOW + 300, "created_at": NOW - 60}
    base.update(o)
    return PaymentRecord(**base)


def receipt(**o):
    r = {
        "transactionHash": TX,
        "status": "0x1",
        "blockNumber": "0x64",
        "logs": [
            {"address": USDC, "topics": [AUTHORIZATION_USED_TOPIC, pad(FROM), NONCE], "data": "0x"},
            {"address": USDC, "topics": [TRANSFER_TOPIC, pad(FROM), pad(PAYTO)], "data": word(2000)},
        ],
    }
    r.update(o)
    return r


@pytest.fixture(autouse=True)
def _reset():
    _reset_chain_cache()


class Chain:
    def __init__(self, views):
        self.views = views
        self.methods: list[str] = []
        self.urls: list[str] = []

    def __call__(self, url, body):
        self.urls.append(url)
        self.methods.append(body["method"])
        v = self.views.get(url)
        if v is None or v.get("fail"):
            raise ConnectionError("connect failed")
        m, p = body["method"], body["params"]
        if m == "eth_chainId":
            res = v.get("chain", "0x2105")
        elif m == "eth_getBlockByNumber":
            res = {"number": "0xc8", "timestamp": hex(NOW)}
        elif m == "eth_call":
            assert p[0]["to"] == USDC
            assert p[0]["data"] == AUTHORIZATION_STATE_SELECTOR + pad(FROM)[2:] + NONCE[2:]
            res = word(1 if v.get("used", {}).get(p[1]) else 0)
        elif m == "eth_getLogs":
            res = v.get("logs", [{"transactionHash": TX}])
        elif m == "eth_getTransactionReceipt":
            res = v.get("receipt", receipt())
        else:  # pragma: no cover
            raise AssertionError(m)
        return {"jsonrpc": "2.0", "id": 1, "result": res}


def run(chain, r=None, **kw):
    return check_payment_state(r or rec(), rpcs=RPCS, transport=chain, now=lambda: NOW, **kw)


def test_constants_are_real_keccak_values():
    eth_utils = pytest.importorskip("eth_utils")
    assert AUTHORIZATION_STATE_SELECTOR == "0x" + eth_utils.keccak(text="authorizationState(address,bytes32)")[:4].hex()
    assert AUTHORIZATION_USED_TOPIC == "0x" + eth_utils.keccak(text="AuthorizationUsed(address,bytes32)").hex()
    assert TRANSFER_TOPIC == "0x" + eth_utils.keccak(text="Transfer(address,address,uint256)").hex()
    assert DEFAULT_BASE_RPCS == ("https://mainnet.base.org", "https://base-rpc.publicnode.com")


def test_settled_needs_both_rpcs_and_exact_receipt():
    c = Chain({RPCS[0]: {"used": {"safe": True}}, RPCS[1]: {"used": {"safe": True}}})
    s = run(c)
    assert (s.state, s.tx_hash, s.tag, s.rpc_hosts) == ("settled", TX, "safe", ["rpc-one.example", "rpc-two.example"])
    assert set(c.methods) <= READ and all("botsrated" not in u for u in c.urls)


def test_unknown_before_valid_before_plus_margin():
    s = run(Chain({RPCS[0]: {}, RPCS[1]: {}}))
    assert (s.state, s.code, s.reason, s.wait_until) == ("unknown", "payment_state_unknown", "not_settled_yet", NOW + 360)
    assert "Do not sign a new payment for this purchase before" in s.message


def test_expired_unsettled_only_after_margin_at_finalized():
    c = Chain({RPCS[0]: {}, RPCS[1]: {}})
    s = run(c, rec(valid_before=NOW - 100))
    assert s.state == "expired_unsettled"
    assert c.methods.count("eth_call") == 4


def test_margin_at_least_30s():
    assert run(Chain({RPCS[0]: {}, RPCS[1]: {}}), rec(valid_before=NOW - 10), margin_seconds=0).state == "unknown"


@pytest.mark.parametrize(
    "views,reason",
    [
        ({RPCS[0]: {"used": {"safe": True}}, RPCS[1]: {}}, "rpcs_disagree"),
        ({RPCS[0]: {"used": {"safe": True}}, RPCS[1]: {"fail": True}}, "rpc_error"),
        ({RPCS[0]: {"chain": "0x1", "used": {"safe": True}}, RPCS[1]: {"used": {"safe": True}}}, "rpc_error"),
    ],
)
def test_failures_are_unknown(views, reason):
    s = run(Chain(views))
    assert (s.state, s.reason) == ("unknown", reason)


def test_two_rpcs_on_different_hosts_required():
    c = Chain({})
    assert check_payment_state(rec(), rpcs=[RPCS[0]], transport=c).reason == "need_two_rpcs_on_different_hosts"
    assert check_payment_state(rec(), rpcs=[RPCS[0], RPCS[0] + "/v2"], transport=c).state == "unknown"
    assert c.methods == []


def test_only_base_usdc():
    c = Chain({})
    assert run(c, rec(network="eip155:1")).reason == "unsupported_network_or_asset"
    assert run(c, rec(asset="0x" + "9" * 40)).state == "unknown"


BAD = {
    "wrong amount": receipt(logs=[receipt()["logs"][0], {**receipt()["logs"][1], "data": word(2001)}]),
    "other contract": receipt(logs=[receipt()["logs"][0], {**receipt()["logs"][1], "address": "0x" + "9" * 40}]),
    "other payTo": receipt(logs=[receipt()["logs"][0], {**receipt()["logs"][1], "topics": [TRANSFER_TOPIC, pad(FROM), pad("0x" + "d" * 40)]}]),
    "no AuthorizationUsed": receipt(logs=[receipt()["logs"][1]]),
    "reverted": receipt(status="0x0"),
    "above safe block": receipt(blockNumber="0x1000"),
}


@pytest.mark.parametrize("name", list(BAD))
def test_used_but_receipt_does_not_prove_payment_is_unknown(name):
    v = {"used": {"safe": True}, "receipt": BAD[name]}
    assert run(Chain({RPCS[0]: v, RPCS[1]: v})).state == "unknown"


def test_invalid_tx_hint_ignored_and_logs_searched():
    c = Chain({RPCS[0]: {"used": {"safe": True}}, RPCS[1]: {"used": {"safe": True}}})
    assert run(c, rec(tx_hash_hint="0xnot-a-hash")).state == "settled"
    assert "eth_getLogs" in c.methods


def test_guard_payment_state_uses_configured_rpcs():
    c = Chain({RPCS[0]: {"used": {"safe": True}}, RPCS[1]: {"used": {"safe": True}}})
    g = PaymentGuard(hosted=False, onchain={"rpcs": RPCS, "transport": c, "now": lambda: NOW})
    assert g.payment_state(rec()).state == "settled"
    assert set(c.urls) <= set(RPCS)
    assert json.dumps(c.methods)  # read methods only
    assert set(c.methods) <= READ
