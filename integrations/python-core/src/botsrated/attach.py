"""Attach a BotsRated PaymentGuard to an x402 client. One shared copy for every framework package.

``attach_payment_guard`` registers the guard's before-payment hook on the client you already use to pay.
``build_payment_guard`` builds the same guard without registering it. Neither signs, sends, or holds a payment.
"""

from __future__ import annotations

import os
from typing import Any, Literal

from .payment_guard import POLICIES, PaymentGuard

PresetName = Literal["carefulBuyer", "warn", "strict"]
FailMode = Literal["open", "closed"]

PRESETS: tuple[str, ...] = ("carefulBuyer", "warn", "strict")
FAIL_MODES: tuple[str, ...] = ("open", "closed")
TOKEN_ENV = "BOTSRATED_TOKEN"

__all__ = ["FAIL_MODES", "PRESETS", "TOKEN_ENV", "FailMode", "PresetName", "attach_payment_guard", "build_payment_guard"]


def _token_from(token: str | None) -> str | None:
    """Explicit ``token`` wins. Omit it to read ``BOTSRATED_TOKEN``. Empty means unset."""
    if token is None:
        env = os.environ.get(TOKEN_ENV)
        token = env if isinstance(env, str) else None
    if not isinstance(token, str) or token == "":
        return None
    return token


def build_payment_guard(
    *,
    preset: PresetName | None = None,
    token: str | None = None,
    fail_mode: FailMode | None = None,
    read_env: bool = True,
) -> PaymentGuard:
    """Build a ``PaymentGuard`` from the three choices every framework package offers.

    ``preset`` is ``warn`` (warn only), ``carefulBuyer``, or ``strict`` (the strict rule table). Omit it for
    the guard's advice-only default.
    ``fail_mode`` is ``open`` or ``closed``. Omit it to leave the guard fail-open. When a check returns no
    decision, closed stops the payment and open reports info. A missing decision is not turned into a pass.
    ``token`` (or ``BOTSRATED_TOKEN`` when ``token`` is omitted) is sent as
    ``remote_policy={"token", "fail_mode"}``, never as a bare string. With no token, no policy call is made.
    ``read_env=False`` uses only the ``token`` argument and never reads ``BOTSRATED_TOKEN``.
    """
    if preset is not None and preset not in PRESETS:
        raise ValueError('preset must be "carefulBuyer", "warn", or "strict".')
    if fail_mode is not None and fail_mode not in FAIL_MODES:
        raise ValueError('fail_mode must be "open" or "closed".')

    kwargs: dict[str, Any] = {}
    if preset == "strict":
        # PaymentGuard's own preset names are warn, carefulBuyer, and dry-run-only.
        # strict is passed as its rule table.
        kwargs["policy"] = POLICIES["strict"]
    elif preset is not None:
        kwargs["preset"] = preset
    if fail_mode == "closed":
        kwargs["fail_open"] = False
    elif fail_mode == "open":
        kwargs["fail_open"] = True
    resolved = _token_from(token) if read_env else (token if isinstance(token, str) and token != "" else None)
    if resolved:
        kwargs["remote_policy"] = {"token": resolved, "fail_mode": fail_mode or "open"}
    return PaymentGuard(**kwargs)


def attach_payment_guard(
    x402_client: Any,
    *,
    preset: PresetName | None = None,
    token: str | None = None,
    fail_mode: FailMode | None = None,
    read_env: bool = True,
) -> PaymentGuard:
    """Register a ``PaymentGuard`` on ``x402_client`` and return the guard.

    Arguments are the same as :func:`build_payment_guard`. Sync clients are those whose class name ends with
    ``Sync``; ``PaymentGuard.install`` picks the hook style.
    """
    guard = build_payment_guard(preset=preset, token=token, fail_mode=fail_mode, read_env=read_env)
    guard.install(x402_client)
    return guard
