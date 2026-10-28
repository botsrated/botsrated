"""Attach a BotsRated PaymentGuard to an x402 client.

This registers the guard's before-payment hook. It does not sign, send, or hold a payment.
``botsrated_tools()`` does not call this.
"""

from __future__ import annotations

import inspect
from typing import Any, Literal

PresetName = Literal["carefulBuyer", "warn", "strict"]
FailMode = Literal["open", "closed"]

_PRESETS = ("carefulBuyer", "warn", "strict")
_FAIL_MODES = ("open", "closed")
# Names the core SDK may add. The token is passed only when one of these is a real parameter.
_REMOTE_POLICY_PARAMS = ("remote_policy", "remotePolicy")


def _payment_guard() -> tuple[Any, type]:
    try:
        from botsrated.payment_guard import POLICIES, PaymentGuard
    except ImportError as exc:  # botsrated 0.1.x has no PaymentGuard
        raise ImportError("attach_payment_guard needs botsrated>=0.2.1 (PaymentGuard).") from exc
    return POLICIES, PaymentGuard


def _remote_policy_kwargs(
    guard_cls: type, token: str | None, fail_mode: FailMode | None = None
) -> dict[str, dict[str, str]]:
    """Pass ``token`` as a remote policy mapping only when PaymentGuard accepts it.

    The mapping is ``{"token": token, "fail_mode": fail_mode}``. ``fail_mode`` defaults to
    ``open``, matching the guard's fail-open default. Until that parameter exists, the token
    is dropped. Nothing is sent.
    """
    if not token:
        return {}
    params = inspect.signature(guard_cls.__init__).parameters
    for name in _REMOTE_POLICY_PARAMS:
        if name in params:
            return {name: {"token": token, "fail_mode": fail_mode or "open"}}
    return {}


def attach_payment_guard(
    x402_client: Any,
    *,
    preset: PresetName | None = None,
    token: str | None = None,
    fail_mode: FailMode | None = None,
) -> Any:
    """Register PaymentGuard on ``x402_client`` and return the guard.

    ``preset`` is your choice: ``warn`` (advice only), ``carefulBuyer``, or ``strict``
    (same stops as ``carefulBuyer``). Omit it for the guard's advice-only default.
    ``fail_mode`` is ``open`` or ``closed``. Omit it to leave the guard fail-open.
    ``token`` is forwarded as ``remote_policy`` (or ``remotePolicy``), as
    ``{"token": token, "fail_mode": fail_mode or "open"}``, only when
    ``PaymentGuard`` accepts that argument. Otherwise the attach stays on the local preset
    and the token is not sent.

    The guard does not sign a payment. Sync clients are those whose class name ends with
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
    kwargs.update(_remote_policy_kwargs(payment_guard, token, fail_mode))
    guard = payment_guard(**kwargs)
    guard.install(x402_client)
    return guard
