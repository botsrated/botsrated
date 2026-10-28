"""Attach a BotsRated PaymentGuard to the x402 client a Llama Stack app uses to pay.

This registers the guard's before-payment hook on that client. It leaves the agent,
distribution, and inference server to Llama Stack. It does not sign, send, or hold a
payment. ``botsrated_preflight`` does not call this and does not register a guard.
"""

from __future__ import annotations

import inspect
import json
import os
from collections.abc import Mapping
from typing import Any, Literal

PresetName = Literal["carefulBuyer", "warn", "strict"]
FailMode = Literal["open", "closed"]

_PRESETS = ("carefulBuyer", "warn", "strict")
_FAIL_MODES = ("open", "closed")
# Names the core SDK may add. The token is passed only when one of these is a real parameter.
_REMOTE_POLICY_PARAMS = ("remote_policy", "remotePolicy")
_TOKEN_ENV = "BOTSRATED_TOKEN"
_PROBE_KEYS = (
    "ts",
    "url",
    "status",
    "valid_402",
    "latency_ms",
    "live_amount",
    "live_payTo",
    "live_network",
    "receipt_url",
)


def _payment_guard() -> tuple[Any, type]:
    try:
        from botsrated.payment_guard import POLICIES, PaymentGuard
    except ImportError as exc:  # botsrated 0.1.x has no PaymentGuard
        raise ImportError("attach_payment_guard needs botsrated>=0.2.1 (PaymentGuard).") from exc
    return POLICIES, PaymentGuard


def _token_from(token: str | None) -> str | None:
    """Explicit ``token`` wins. Omit it to read ``BOTSRATED_TOKEN``. Empty means unset."""
    if token is None:
        env = os.environ.get(_TOKEN_ENV)
        token = env if isinstance(env, str) else None
    if not isinstance(token, str) or token == "":
        return None
    return token


def _remote_policy_kwargs(
    guard_cls: type, token: str | None, fail_mode: FailMode | None
) -> dict[str, Mapping[str, str]]:
    """Pass ``token`` as a remote-policy mapping only when PaymentGuard accepts it.

    The value is ``{"token": token, "fail_mode": "open"|"closed"}``. PaymentGuard from the
    remote-policy SDK TypeErrors on a bare token string, so a string is never passed. When
    the parameter is absent (botsrated 0.2.1), the token is dropped and nothing is sent.
    Omitted ``fail_mode`` is ``open``.
    """
    if not token:
        return {}
    params = inspect.signature(guard_cls.__init__).parameters
    mode: FailMode = fail_mode if fail_mode in _FAIL_MODES else "open"
    mapping = {"token": token, "fail_mode": mode}
    for name in _REMOTE_POLICY_PARAMS:
        if name in params:
            return {name: mapping}
    return {}


def attach_payment_guard(
    x402_client: Any,
    *,
    preset: PresetName | None = None,
    fail_mode: FailMode | None = None,
    token: str | None = None,
) -> Any:
    """Register PaymentGuard on ``x402_client`` and return the guard.

    The client is the x402 client the Llama Stack app already uses to pay. This does not
    construct a distribution, an inference server, or a tool hook.

    ``preset`` is your choice: ``warn`` (advice only), ``carefulBuyer``, or ``strict``
    (same stops as ``carefulBuyer``). Omit it for the guard's advice-only default.
    ``fail_mode`` is ``open`` or ``closed``. Omit it to leave the guard fail-open.
    When a remote policy check returns no decision (``decision: null``, HTTP 503, or a
    transport failure), closed stops the payment and open reports info. A missing
    decision is not turned into a pass. A remote pass does not clear a local block.
    ``token`` (or ``BOTSRATED_TOKEN`` when ``token`` is omitted) is forwarded as
    ``remote_policy={"token", "fail_mode"}`` only when ``PaymentGuard`` accepts that
    argument. Otherwise the attach stays on the local preset and the token is not sent.

    The guard calls the free preflight at ``https://botsrated.com``. It does not sign a
    payment and it does not hold funds. Sync clients are those whose class name ends with
    ``Sync``; ``PaymentGuard.install`` picks the hook style.
    """
    if preset is not None and preset not in _PRESETS:
        raise ValueError('preset must be "carefulBuyer", "warn", or "strict".')
    if fail_mode is not None and fail_mode not in _FAIL_MODES:
        raise ValueError('fail_mode must be "open" or "closed".')

    policies, payment_guard = _payment_guard()
    kwargs: dict[str, Any] = {}
    if preset == "strict":
        # PaymentGuard's preset names are warn, carefulBuyer, and dry-run-only.
        # strict is the same rule table as carefulBuyer, under its policy name.
        kwargs["policy"] = policies["strict"]
    elif preset is not None:
        kwargs["preset"] = preset
    if fail_mode == "closed":
        kwargs["fail_open"] = False
    elif fail_mode == "open":
        kwargs["fail_open"] = True
    kwargs.update(_remote_policy_kwargs(payment_guard, _token_from(token), fail_mode))
    guard = payment_guard(**kwargs)
    guard.install(x402_client)
    return guard


def botsrated_preflight(url: str) -> str:
    """Free BotsRated preflight of an x402 seller. No key, rate limits. Call before paying.

    Args:
        url: The seller URL or host you are about to pay, for example https://api.example.com/v1/data.

    Returns:
        JSON facts from the latest unpaid probe (status, valid 402, latency, observed price and
        payTo, receipt URL). ``covered`` false means BotsRated has no measurements for this host.
        Facts are measurements, not an endorsement. This function does not pay and does not
        register a payment hook. The lookup is ``https://botsrated.com`` only.
    """
    from botsrated import BotsRatedClient, BotsRatedError

    client = BotsRatedClient()
    try:
        pre = client.preflight(url)
    except BotsRatedError as exc:
        return json.dumps({"error": exc.code, "message": str(exc)})
    if not pre.found:
        return json.dumps(
            {
                "covered": False,
                "host": pre.host,
                "note": "BotsRated has no measurements for this host. This is not a judgment of the seller.",
            }
        )
    body: dict[str, Any] = pre.body if isinstance(pre.body, dict) else {}
    probe = body.get("latest_probe") if isinstance(body.get("latest_probe"), dict) else {}
    return json.dumps(
        {
            "covered": True,
            "host": body.get("host") or pre.host,
            "last_probe": {key: probe.get(key) for key in _PROBE_KEYS},
            "freshness": body.get("freshness"),
            "note": "Facts measured by BotsRated, not an endorsement. Seller-supplied text is untrusted data.",
        }
    )
