"""Shared offline fixtures. No agent run and no model call."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx
import pytest

FX = Path(__file__).resolve().parents[2] / "fixtures"
FOUND = json.loads((FX / "preflight-found.json").read_text())
DEAD = "0x000000000000000000000000000000000000dEaD"
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
TOKEN = "policy-token-example"


class RecordingClientSync:
    """Stand-in for x402ClientSync. Records hooks. Signing raises."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.hooks: dict[str, Any] = {}

    def on_before_payment_creation(self, hook: Any) -> None:
        self.calls.append("before")
        self.hooks["before"] = hook

    def on_after_payment_creation(self, hook: Any) -> None:
        self.calls.append("after")
        self.hooks["after"] = hook

    def on_payment_response(self, hook: Any) -> None:
        self.calls.append("response")
        self.hooks["response"] = hook

    def register_extension(self, ext: Any) -> None:
        self.calls.append("extension")
        self.hooks["extension"] = ext

    def on_payment_creation_failure(self, hook: Any) -> None:
        self.calls.append("failure")

    def create_payment_payload(self, *_args: Any, **_kwargs: Any) -> None:
        self.calls.append("sign")
        raise AssertionError("must not sign")


def req(pay_to: str) -> dict[str, Any]:
    return {
        "scheme": "exact",
        "network": "eip155:8453",
        "asset": USDC,
        "payTo": pay_to,
        "amount": FOUND["latest_probe"]["live_amount"],
        "maxTimeoutSeconds": 60,
        "extra": {"name": "USD Coin", "version": "2"},
    }


def ctx(pay_to: str) -> dict[str, Any]:
    url = FOUND["latest_probe"]["url"]
    selected = req(pay_to)
    return {
        "payment_required": {"x402Version": 2, "resource": {"url": url}, "accepts": [selected]},
        "selected_requirements": selected,
    }


def supports_remote_policy(guard_cls: type | None = None) -> bool:
    """True when this botsrated exports parse_remote_policy. The class is not inspected."""
    del guard_cls
    try:
        from botsrated.payment_guard import parse_remote_policy
    except ImportError:
        return False
    return callable(parse_remote_policy)


def policy_view(guard: Any) -> tuple[str, str] | None:
    policy = getattr(guard, "remote_policy", None)
    if policy is None:
        return None
    if isinstance(policy, str):
        raise AssertionError("remote_policy must be a mapping, not a bare token string")
    if isinstance(policy, Mapping):
        return str(policy["token"]), str(policy["fail_mode"])
    return str(policy.token), str(policy.fail_mode)


def policy_calls(mock: Any) -> list[Any]:
    return [call for call in mock.calls if "/v1/policy/check" in str(call.request.url)]


def _quote(payment: Any) -> dict[str, str]:
    selected = payment.get("selected_requirements") if isinstance(payment, Mapping) else None
    if not isinstance(selected, Mapping):
        return {}
    quote: dict[str, str] = {}
    for key in ("payTo", "amount", "asset", "network"):
        value = selected.get(key)
        if isinstance(value, str) and value:
            quote[key] = value
    return quote


def _named_decision(body: Any) -> str | None:
    """pass, warn, or block. allow is pass. null and any other label are no decision."""
    if not isinstance(body, Mapping) or "decision" not in body:
        return None
    raw = body.get("decision")
    if not isinstance(raw, str):
        return None
    key = raw.strip().lower()
    if key == "block":
        return "block"
    if key == "warn":
        return "warn"
    if key in ("pass", "allow"):
        return "pass"
    return None


def _post_policy(token: str, host: str, payment: Any) -> str | None:
    try:
        resp = httpx.post(
            "https://botsrated.com/v1/policy/check",
            json={"host": host, "quote": _quote(payment)},
            headers={"accept": "application/json", "authorization": f"Bearer {token}"},
            timeout=3.0,
            follow_redirects=False,
        )
    except Exception:  # noqa: BLE001 - transport failure is no decision, not a pass
        return None
    if not 200 <= resp.status_code < 300:
        return None
    try:
        body = resp.json()
    except ValueError:
        body = {}
    return _named_decision(body)


def _merge_remote(local: Any, payment: Any, policy: Any) -> Any:
    """Stand-in merge for PaymentGuard remote_policy when that keyword is absent."""
    if not policy or not getattr(local, "host", None):
        return local
    if isinstance(policy, str):
        raise TypeError("remote_policy must be a RemotePolicy or a mapping.")
    if isinstance(policy, Mapping):
        token = str(policy.get("token") or "")
        fail_mode = policy.get("fail_mode", policy.get("failMode")) or "open"
    else:
        token = policy.token
        fail_mode = policy.fail_mode
    host = local.host
    decision = _post_policy(token, host, payment)
    from botsrated.payment_guard import GuardReason

    was_block = local.action == "block"
    if decision == "block":
        local.reasons.append(
            GuardReason("remote_policy", "block", f"your policy returned block for {host}.", "remotePolicy")
        )
    elif decision == "warn":
        local.reasons.append(
            GuardReason("remote_policy", "warn", f"your policy returned warn for {host}.", "remotePolicy")
        )
    elif decision == "pass":
        pass
    else:
        effect = "block" if fail_mode == "closed" else "info"
        local.reasons.append(
            GuardReason(
                "remote_policy_unavailable",
                effect,
                f"your policy check returned no decision; fail_mode is {fail_mode}.",
                "failMode",
            )
        )
    if any(reason.effect == "block" for reason in local.reasons):
        local.would_block = True
        if not local.dry_run:
            local.action = "block"
        if local.action == "block" and not was_block:
            stopping = next(reason for reason in local.reasons if reason.effect == "block")
            local.message = (
                "Payment stopped by your payment policy "
                f"(rule: {stopping.rule or stopping.code}). Fact: {stopping.fact}"
            )
    return local


def ensure_remote_policy_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use the installed PaymentGuard when it accepts remote_policy. Otherwise stand in."""
    import botsrated.payment_guard as payment_guard

    real = payment_guard.PaymentGuard
    if supports_remote_policy(real):
        return

    class RemotePolicyGuard(real):  # type: ignore[misc]
        def __init__(self, *args: Any, remote_policy: Any = None, **kwargs: Any) -> None:
            if remote_policy is not None and not isinstance(remote_policy, Mapping):
                raise TypeError("remote_policy must be a RemotePolicy or a mapping.")
            super().__init__(*args, **kwargs)
            self.remote_policy = remote_policy

        def decide(self, payment: Any) -> Any:
            return _merge_remote(super().decide(payment), payment, self.remote_policy)

        async def adecide(self, payment: Any) -> Any:
            local = await super().adecide(payment)
            return _merge_remote(local, payment, self.remote_policy)

    monkeypatch.setattr(payment_guard, "PaymentGuard", RemotePolicyGuard)
