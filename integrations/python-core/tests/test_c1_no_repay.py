"""C1 (Security review 2026-10-24): the payment guard must never cause a second payment.

- Hook adapters discard whatever the hook body returns (observe-only hooks always return None).
- The payment-creation-failure hook is never registered.
- The guard's modules never import a signer, never build or send a payment header, never ask a client to create
  a payment payload, and contain no retry or resend code (grep over the source and the built wheel).
- With the real x402 httpx transport and a seller that fails after payment, exactly one payload is created.
"""

from __future__ import annotations

import ast
import asyncio
import base64
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from botsrated import POLICIES, PaymentGuard
from botsrated.payment_guard import (
    abort_only,
    abort_only_async,
    observe_only,
    observe_only_async,
)

ROOT = Path(__file__).resolve().parents[1]
GUARD_MODULES = ["payment_guard.py", "onchain.py", "util.py"]
FORBIDDEN = [
    ("create_payment_payload", re.compile(r"create_payment_payload|createPaymentPayload")),
    ("recovered", re.compile(r"recovered", re.IGNORECASE)),
    ("failure hook", re.compile(r"on_payment_creation_failure|onPaymentCreationFailure")),
    ("typed-data signing", re.compile(r"sign_typed_data|signTypedData|sign_message")),
    ("private key", re.compile(r"private_key|privateKey|mnemonic", re.IGNORECASE)),
    ("payment header", re.compile(r"PAYMENT-SIGNATURE|X-PAYMENT\b", re.IGNORECASE)),
    ("transaction sending", re.compile(r"eth_sendRawTransaction|eth_sendTransaction|cancelAuthorization|transferWithAuthorization")),
    ("retry pipeline", re.compile(r"retry\.mjs|runReplay|RETRY_CHECK")),
    ("dynamic code", re.compile(r"\beval\s*\(|\bexec\s*\(|__import__|importlib")),
]
ALLOWED_IMPORTS = {"__future__", "asyncio", "inspect", "json", "math", "re", "secrets", "threading", "time", "collections.abc", "contextlib", "contextvars", "dataclasses", "datetime", "typing", "urllib.parse", "httpx", "botsrated.onchain", "botsrated.util", "x402"}


# -- adapters -----------------------------------------------------------------------------------------------------

EVIL = [lambda c: SimpleNamespace(recovered=True), lambda c: {"recovered": True, "payload": {}}, lambda c: "x", lambda c: 1, lambda c: 1 / 0]


@pytest.mark.parametrize("body", EVIL)
def test_observe_only_discards_return_values(body):
    assert observe_only(body)({}) is None

    async def abody(c):
        return body(c)

    assert asyncio.run(observe_only_async(abody)({})) is None


def test_abort_only_returns_none_or_abort_result():
    pytest.importorskip("x402")
    from x402 import AbortResult

    assert abort_only(lambda c: (False, "x"))({}) is None
    out = abort_only(lambda c: (True, "r"))({})
    assert isinstance(out, AbortResult) and out.reason == "r"
    assert abort_only(lambda c: 1 / 0)({}) is None

    async def stop(c):
        return (True, "r")

    assert isinstance(asyncio.run(abort_only_async(stop)({})), AbortResult)


# -- fuzzed contexts ----------------------------------------------------------------------------------------------


class Hostile:
    def __getattr__(self, name):
        raise RuntimeError("hostile getter")


def _contexts(found):
    r = {"scheme": "exact", "network": "eip155:8453", "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "payTo": found["latest_probe"]["live_payTo"], "amount": "2000", "maxTimeoutSeconds": 60}
    auth = {"from": "0x" + "a" * 40, "nonce": "0x" + "1" * 64, "validBefore": "1"}
    return [
        None, 0, "", "x", [], {}, Hostile(),
        {"payment_required": None, "selected_requirements": None},
        {"payment_required": {"x402Version": 2, "resource": {"url": "http://[bad"}, "accepts": [r]}, "selected_requirements": {**r, "payTo": "x" * 500}},
        {"payment_required": {"x402Version": 2, "resource": {"url": found["latest_probe"]["url"]}, "accepts": [r]}, "selected_requirements": {**r, "payTo": "0x" + "d" * 40}},
        {"payment_payload": {"x402Version": 2, "payload": {"authorization": Hostile()}, "accepted": r}, "requirements": r},
        {"payment_payload": {"x402Version": 2, "payload": {"signature": "0x1", "authorization": auth}, "accepted": r}, "requirements": r, "settle_response": {"success": False}},
        {"payment_payload": {"x402Version": 2, "payload": {}, "accepted": r}, "requirements": r, "settle_response": {"success": True, "transaction": "0x" + "f" * 64}},
        {"payment_payload": "garbage", "requirements": 7, "error": RuntimeError("5xx after settle")},
    ]


def test_fuzzed_contexts(found):
    pytest.importorskip("x402")
    from x402 import AbortResult

    answers = [lambda q: httpx.Response(200, json=found), lambda q: httpx.Response(500), lambda q: httpx.Response(200, text="not json"), lambda q: httpx.Response(404, json={"error": {"code": "host_not_covered"}})]
    configs = [{}, {"policy": POLICIES["strict"]}, {"dry_run": True, "policy": POLICIES["strict"]}, {"fail_open": False, "policy": POLICIES["strict"]}, {"hosted": False}]
    runs = 0
    for cfg in configs:
        for a in answers:
            g = PaymentGuard(http=httpx.Client(transport=httpx.MockTransport(a)), async_http=httpx.AsyncClient(transport=httpx.MockTransport(a)), on_decision=lambda d: 1 / 0, **cfg)
            for c in _contexts(found):
                assert g.after_payment_creation(c) is None
                assert g.payment_response(c) is None
                assert asyncio.run(g.aafter_payment_creation(c)) is None
                assert asyncio.run(g.apayment_response(c)) is None
                for before in (g.before_payment_creation(c), asyncio.run(g.abefore_payment_creation(c))):
                    assert before is None or isinstance(before, AbortResult)
                    if cfg in ({}, configs[2]):
                        assert before is None
                runs += 1
    assert runs == len(configs) * len(answers) * len(_contexts(found))


def _recorder(calls, name):
    return lambda *a: calls.append(name)


def test_install_never_registers_failure_hook():
    calls: list[str] = []
    client = SimpleNamespace()
    for name in ("on_before_payment_creation", "on_after_payment_creation", "on_payment_response", "register_extension", "on_payment_creation_failure", "create_payment_payload"):
        setattr(client, name, _recorder(calls, name))
    PaymentGuard().install(client)
    assert sorted(calls) == ["on_after_payment_creation", "on_before_payment_creation", "on_payment_response", "register_extension"]


# -- source and wheel grep -----------------------------------------------------------------------------------------


def _check_text(name: str, text: str) -> None:
    for label, rx in FORBIDDEN:
        assert not rx.search(text), f"{name} contains {label}"


def test_guard_sources_have_no_signing_resend_or_retry_capability():
    for m in GUARD_MODULES:
        path = ROOT / "src" / "botsrated" / m
        text = path.read_text()
        _check_text(m, text)
        for node in ast.walk(ast.parse(text)):
            if isinstance(node, ast.Import):
                mods = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                mods = [node.module or ""]
            else:
                continue
            for mod in mods:
                assert mod in ALLOWED_IMPORTS, f"{m} imports {mod}"


def test_built_wheel_guard_modules_pass_the_same_grep():
    with tempfile.TemporaryDirectory() as out:
        builders = [
            [sys.executable, "-m", "pip", "wheel", "--no-deps", "--wheel-dir", out, str(ROOT)],
            [sys.executable, "-m", "build", "--wheel", "--outdir", out, str(ROOT)],
            ["uv", "build", "--wheel", "--out-dir", out, str(ROOT)],
        ]
        for cmd in builders:
            try:
                subprocess.run(cmd, check=True, capture_output=True, timeout=300)
                break
            except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
                continue
        else:
            pytest.skip("no wheel builder available")
        wheels = list(Path(out).glob("*.whl"))
        assert len(wheels) == 1
        with zipfile.ZipFile(wheels[0]) as z:
            names = z.namelist()
            for m in GUARD_MODULES:
                _check_text(f"wheel:{m}", z.read(f"botsrated/{m}").decode())
            for n in names:
                if n.endswith(".py"):
                    text = z.read(n).decode()
                    assert not re.search(r"on_payment_creation_failure|recovered|\beval\s*\(|\bexec\s*\(", text), n


def test_dependency_ranges_are_upper_bounded():
    text = (ROOT / "pyproject.toml").read_text()
    assert '"httpx>=0.27,<1"' in text
    assert '"x402[httpx,evm]>=2.25,<3"' in text


# -- integration with the real x402 SDK -----------------------------------------------------------------------------


def _x402_setup(found, after_pay_status, extensions=None, guard_kw=None, botsrated_answer=None):
    x402 = pytest.importorskip("x402")
    eth_account = pytest.importorskip("eth_account")
    from x402.http.clients.httpx import x402AsyncTransport
    from x402.mechanisms.evm import EthAccountSigner
    from x402.mechanisms.evm.exact import ExactEvmScheme

    client = x402.x402Client()
    client.register("eip155:*", ExactEvmScheme(signer=EthAccountSigner(eth_account.Account.create())))
    created = {"n": 0}
    real = client.create_payment_payload

    async def counting(*a, **k):
        created["n"] += 1
        return await real(*a, **k)

    client.create_payment_payload = counting  # type: ignore[method-assign]
    answer = botsrated_answer or found
    guard = PaymentGuard(http=httpx.Client(transport=httpx.MockTransport(lambda q: httpx.Response(200, json=answer))), async_http=httpx.AsyncClient(transport=httpx.MockTransport(lambda q: httpx.Response(200, json=answer))), **(guard_kw or {}))
    guard.install(client)
    sent: list[dict] = []
    r = {"scheme": "exact", "network": "eip155:8453", "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "payTo": found["latest_probe"]["live_payTo"], "amount": "2000", "maxTimeoutSeconds": 60, "extra": {"name": "USD Coin", "version": "2"}}

    def seller(q: httpx.Request) -> httpx.Response:
        sig = q.headers.get("payment-signature")
        if not sig:
            body = {"x402Version": 2, "resource": {"url": found["latest_probe"]["url"]}, "accepts": [r], **({"extensions": extensions} if extensions else {})}
            return httpx.Response(402, headers={"PAYMENT-REQUIRED": base64.b64encode(json.dumps(body).encode()).decode()}, json={})
        sent.append(json.loads(base64.b64decode(sig)))
        return httpx.Response(after_pay_status, text="upstream error")

    http = httpx.AsyncClient(transport=x402AsyncTransport(client, httpx.MockTransport(seller)))
    get = guard.wrap_async_get(http.get)
    return get, created, sent, guard


@pytest.mark.parametrize("status", [500, 502, 503, 402])
def test_seller_fails_after_payment_exactly_one_payload(found, status):
    get, created, sent, guard = _x402_setup(found, status, {"payment-identifier": {"info": {"required": False}}})
    resp = asyncio.run(get(found["latest_probe"]["url"]))
    assert resp.status_code == status
    assert created["n"] == 1
    assert len(sent) == 1
    assert len(guard.records()) == 1


def test_retry_key_reaches_the_seller_only_when_advertised(found):
    get, _, sent, _ = _x402_setup(found, 200, {"payment-identifier": {"info": {"required": False}}})
    asyncio.run(get(found["latest_probe"]["url"]))
    assert re.fullmatch(r"pay_[0-9a-f]{32}", sent[0]["extensions"]["payment-identifier"]["info"]["id"])
    get2, _, sent2, _ = _x402_setup(found, 200)
    asyncio.run(get2(found["latest_probe"]["url"]))
    assert "payment-identifier" not in (sent2[0].get("extensions") or {})


def test_strict_policy_stops_before_signing(found):
    # BotsRated's probes recorded another payTo than the one the seller asks for -> stopped before anything is signed.
    other = {**found, "latest_probe": {**found["latest_probe"], "live_payTo": "0x" + "e" * 40}}
    get, _created, sent, guard = _x402_setup(found, 200, guard_kw={"policy": POLICIES["strict"]}, botsrated_answer=other)
    with pytest.raises(Exception, match="Payment stopped by your payment policy"):
        asyncio.run(get(found["latest_probe"]["url"]))
    assert sent == [] and guard.records() == []
