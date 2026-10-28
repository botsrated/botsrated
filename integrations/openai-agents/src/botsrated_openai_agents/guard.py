"""Attach a BotsRated PaymentGuard to the x402 client an OpenAI Agents SDK app uses to pay.

This registers the guard's before-payment hook on that client. It does not replace
``Agent`` or ``Runner``, and it does not sign, send, or hold a payment.
``botsrated_preflight_tools()`` does not call this.
"""

from __future__ import annotations

from typing import Any, Literal

PresetName = Literal["carefulBuyer", "warn", "strict"]
FailMode = Literal["open", "closed"]

_PRESETS = ("carefulBuyer", "warn", "strict")
_FAIL_MODES = ("open", "closed")


def _payment_guard() -> tuple[Any, type]:
    try:
        from botsrated.payment_guard import POLICIES, PaymentGuard
    except ImportError as exc:  # botsrated 0.1.x has no PaymentGuard
        raise ImportError("attach_payment_guard needs botsrated>=0.2.1 (PaymentGuard).") from exc
    return POLICIES, PaymentGuard


_MISSING = object()


def _parse_remote_policy() -> Any:
    """Return ``parse_remote_policy`` when this install has it, else None.

    That function is the capability gate. A constructor signature is not consulted.
    """
    try:
        from botsrated import payment_guard as payment_guard_mod
    except ImportError:
        return None
    normalizer = getattr(payment_guard_mod, "parse_remote_policy", None)
    return normalizer if callable(normalizer) else None


def _remote_policy_kwargs(
    token: str | None,
    fail_mode: FailMode | None = None,
    *,
    normalizer: Any = _MISSING,
) -> dict[str, dict[str, str]]:
    """Pass ``token`` as ``remote_policy`` only when ``parse_remote_policy`` exists.

    The value is ``{"token": token, "fail_mode": "open"|"closed"}``, never a bare string.
    When ``token`` is set and the normalizer is missing, raise. The token is not dropped.
    Omitted ``fail_mode`` is ``open``.
    """
    if not token:
        return {}
    if normalizer is _MISSING:
        normalizer = _parse_remote_policy()
    if not callable(normalizer):
        raise TypeError(
            "token is set but this botsrated install has no parse_remote_policy. "
            "Install botsrated>=0.3.0,<0.4 so the token is sent. The token was not dropped."
        )
    mode: FailMode = fail_mode if fail_mode in _FAIL_MODES else "open"
    return {"remote_policy": {"token": token, "fail_mode": mode}}


def attach_payment_guard(
    x402_client: Any,
    *,
    preset: PresetName | None = None,
    token: str | None = None,
    fail_mode: FailMode | None = None,
) -> Any:
    """Register PaymentGuard on ``x402_client`` and return the guard.

    The client is the x402 / payment HTTP client the agent's paid calls already use.
    ``Agent`` and ``Runner`` stay as the OpenAI Agents SDK defined them.

    ``preset`` is your choice: ``warn`` (advice only), ``carefulBuyer``, or ``strict``
    (same stops as ``carefulBuyer``). Omit it for the guard's advice-only default.
    ``fail_mode`` is ``open`` or ``closed``. Omit it to leave the guard fail-open.
    When the hosted preflight cannot be reached, closed stops the payment and open allows it.
    ``token`` (for example ``os.getenv("BOTSRATED_TOKEN")``) is forwarded as ``remote_policy``
    (or ``remotePolicy``), as ``{"token": token, "fail_mode": fail_mode or "open"}``, only when
    ``parse_remote_policy`` is present. A configured token on an install without that normalizer
    raises and is not dropped.

    The guard calls the free preflight at ``https://botsrated.com``. It does not sign a payment
    and it does not hold funds. Sync clients are those whose class name ends with ``Sync``;
    ``PaymentGuard.install`` picks the hook style.
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
    kwargs.update(_remote_policy_kwargs(token, fail_mode))
    guard = payment_guard(**kwargs)
    guard.install(x402_client)
    return guard
