"""Shared, side-effect-free helpers. This module never signs, never pays and never imports a signer."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

VERSION = "0.3.1"
# Sent on hosted BotsRated calls. No install id, wallet or other user identifier.
USER_AGENT = f"botsrated-python/{VERSION}"
BOTSRATED_BASE_URL = "https://botsrated.com"
DISPUTE_URL = "https://botsrated.com/disputes"
TERMS_URL = "https://botsrated.com/terms"
PRIVACY_URL = "https://botsrated.com/privacy"
BASE_MAINNET = "eip155:8453"
BASE_CHAIN_ID_HEX = "0x2105"
# Native USDC on Base. Pinned: never taken from a seller's quote.
BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
# Largest decoded x402 header (PAYMENT-REQUIRED / PAYMENT-RESPONSE) we parse.
MAX_HEADER_BYTES = 16 * 1024


class BotsRatedError(Exception):
    def __init__(self, message: str, code: str, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


# C0/C1 controls, bidi controls and zero-width / BOM characters.
_UNSAFE_CHARS = re.compile("[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]")
_WS = re.compile(r"\s+")


def clean_text(value: Any, max_len: int = 120) -> str:
    """Strip control, bidi and zero-width characters and cap the length. For any seller- or network-supplied text."""
    s = _WS.sub(" ", _UNSAFE_CHARS.sub("", str("" if value is None else value))).strip()
    return s[:max_len] + "…" if len(s) > max_len else s


_ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")
_BYTES32 = re.compile(r"0x[0-9a-fA-F]{64}")
_ATOMIC = re.compile(r"[0-9]{1,78}")


def is_address(v: Any) -> bool:
    return isinstance(v, str) and _ADDRESS.fullmatch(v) is not None


def is_bytes32(v: Any) -> bool:
    return isinstance(v, str) and _BYTES32.fullmatch(v) is not None


is_tx_hash = is_bytes32


def is_atomic_amount(value: Any) -> bool:
    """True for a string of ASCII digits only. ``str.isdigit`` also accepts e.g. Arabic-Indic or superscript digits."""
    return isinstance(value, str) and _ATOMIC.fullmatch(value) is not None


def host_of(url_or_host: str) -> str:
    """Lowercase ASCII host of a URL or bare host: IDNA (punycode) encoded, trailing dot removed.

    Backslashes are read as forward slashes first, the way WHATWG URL parsers (browsers, Node, the TypeScript
    package) treat them in http(s) URLs, so ``https://evil.example\\@good.example`` is ``evil.example`` here too.
    """
    s = str(url_or_host).strip().replace("\\", "/")
    try:
        host = urlsplit(s if "://" in s else f"https://{s}").hostname
    except ValueError:
        host = None
    host = (host or "").rstrip(".")
    if not host or len(host) > 253:
        raise BotsRatedError(f"not a URL or host: {clean_text(url_or_host, 80)}", "invalid_host")
    try:
        return host.encode("idna").decode("ascii").lower()
    except UnicodeError as e:
        raise BotsRatedError(f"not a valid host name: {clean_text(url_or_host, 80)}", "invalid_host") from e


def try_host_of(url_or_host: Any) -> str | None:
    """:func:`host_of` that returns None instead of raising."""
    if not isinstance(url_or_host, str):
        return None
    try:
        return host_of(url_or_host)
    except BotsRatedError:
        return None


def host_and_path(url: Any) -> tuple[str, str] | None:
    """(host, path) of an http(s) URL, without query or fragment. Used locally only; never sent."""
    if not isinstance(url, str):
        return None
    s = url.strip()
    if not re.match(r"(?i)https?://", s):
        return None
    host = try_host_of(s.replace("\\", "/"))
    if not host:
        return None
    try:
        path = urlsplit(s.replace("\\", "/")).path.rstrip("/") or "/"
    except ValueError:
        return None
    return host, path


def same_site_host(a: str, b: str) -> bool:
    """True when two normalized hosts are equal or differ only by a leading ``www.`` (an apex <-> www redirect)."""
    return a == b or a == f"www.{b}" or b == f"www.{a}"
