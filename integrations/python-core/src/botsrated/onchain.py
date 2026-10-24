"""Read-only, on-chain "did this payment land once?" check for an EIP-3009 USDC payment on Base.

- Reads only: eth_chainId, eth_call (authorizationState), eth_getBlockByNumber, eth_getLogs,
  eth_getTransactionReceipt.
- Never signs, never sends a transaction, never resends a payment, never calls botsrated.com.
- Three answers only: "settled", "unknown" (until validBefore + margin, or when the RPCs fail, disagree or lag) and
  "expired_unsettled". There is no "not paid" answer before the authorization has expired, and "expired_unsettled"
  needs the block read on the RPCs to be at or after validBefore + margin (USDC accepts an authorization in any
  block with timestamp < validBefore, so "unused" is final only in a later block).
"""

from __future__ import annotations

import asyncio
import math
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

import httpx

from botsrated.util import (
    BASE_CHAIN_ID_HEX,
    BASE_MAINNET,
    BASE_USDC,
    clean_text,
    is_address,
    is_atomic_amount,
    is_bytes32,
    is_tx_hash,
    try_host_of,
)

# Two different operators: Coinbase's public Base endpoint and Allnodes' PublicNode. Public RPCs see the wallet
# address, nonce and your IP when you run a check; pass your own with ``rpcs``.
DEFAULT_BASE_RPCS: tuple[str, ...] = ("https://mainnet.base.org", "https://base-rpc.publicnode.com")
MIN_MARGIN_SECONDS = 30
MAX_MARGIN_SECONDS = 86_400  # 1 day; larger or infinite margins are clamped to it
MAX_RPCS = 3


def margin_of(v: Any) -> int:
    """``margin_seconds`` as used: default 60; NaN or non-numbers give 60; below 30 (or -inf) is raised to 30;
    above 1 day (or inf) is lowered to 1 day."""
    if v is None or isinstance(v, bool) or not isinstance(v, (int, float)):
        return 60
    if isinstance(v, float) and math.isnan(v):
        return 60
    return math.ceil(min(MAX_MARGIN_SECONDS, max(MIN_MARGIN_SECONDS, v)))
# keccak256("authorizationState(address,bytes32)")[0..4]
AUTHORIZATION_STATE_SELECTOR = "0xe94a0102"
# keccak256("AuthorizationUsed(address,bytes32)")
AUTHORIZATION_USED_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5"
# keccak256("Transfer(address,address,uint256)")
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
_READ_METHODS = frozenset({"eth_chainId", "eth_call", "eth_getBlockByNumber", "eth_getLogs", "eth_getTransactionReceipt"})


@dataclass
class PaymentRecord:
    """What the guard keeps about one payment it saw being created. Never the signature."""

    network: str
    asset: str
    from_: str  # payer (EIP-3009 ``from``)
    pay_to: str
    amount: str  # atomic units
    nonce: str  # bytes32 hex
    valid_before: int  # unix seconds
    valid_after: int | None = None
    host: str | None = None  # seller host, local only
    created_at: int | None = None
    tx_hash_hint: str | None = None  # from the seller / facilitator; verified on chain before it counts


@dataclass
class PaymentState:
    state: Literal["settled", "unknown", "expired_unsettled"]
    rpc_hosts: list[str] = field(default_factory=list)
    tx_hash: str | None = None
    block_number: int | None = None
    tag: str | None = None
    code: str | None = None  # "payment_state_unknown" when state == "unknown"
    reason: str | None = None
    wait_until: int | None = None
    message: str | None = None
    valid_before: int | None = None


class _RpcError(Exception):
    pass


Transport = Callable[[str, dict[str, Any]], Any]
"""``(url, json_rpc_body) -> parsed JSON response``. Injected in tests; defaults to httpx."""

_chain_checked: set[str] = set()


def _reset_chain_cache() -> None:
    """For tests only."""
    _chain_checked.clear()


def _pad32(hex_str: str) -> str:
    return "0x" + hex_str.lower().removeprefix("0x").rjust(64, "0")


def _eq(a: Any, b: str) -> bool:
    return isinstance(a, str) and a.lower() == b.lower()


def _unknown(reason: str, wait_until: int | None, hosts: list[str]) -> PaymentState:
    when = datetime.fromtimestamp(wait_until, tz=timezone.utc).isoformat().replace("+00:00", "Z") if wait_until is not None else "the authorization's validBefore"
    return PaymentState(
        "unknown",
        hosts,
        code="payment_state_unknown",
        reason=reason,
        wait_until=wait_until,
        message=f"Payment state unknown ({reason}). Do not sign a new payment for this purchase before {when}; check again after that.",
    )


def _default_transport(timeout: float) -> Transport:
    def call(url: str, body: dict[str, Any]) -> Any:
        with httpx.Client(timeout=timeout, follow_redirects=False) as c:
            r = c.post(url, json=body, headers={"accept": "application/json"})
        if r.status_code >= 400:
            raise _RpcError(f"HTTP {r.status_code}")
        if len(r.content) > 4_000_000:
            raise _RpcError("response too large")
        return r.json()

    return call


def _rpc(transport: Transport, url: str, method: str, params: list[Any]) -> Any:
    if method not in _READ_METHODS:  # read-only by construction (explicit: asserts are stripped under -O)
        raise _RpcError("method not allowed")
    try:
        body = transport(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    except _RpcError:
        raise
    except Exception as e:
        raise _RpcError(clean_text(e, 80)) from e
    if not isinstance(body, dict):
        raise _RpcError("bad response")
    if body.get("error"):
        raise _RpcError(clean_text((body["error"] or {}).get("message", "rpc error") if isinstance(body["error"], dict) else "rpc error", 80))
    return body.get("result")


def receipt_proves_payment(receipt: Any, rec: PaymentRecord, max_block: int) -> bool:
    """Success, pinned USDC, AuthorizationUsed(from, nonce) and Transfer(from, payTo, amount) in one receipt."""
    if not isinstance(receipt, dict) or not _eq(receipt.get("status"), "0x1"):
        return False
    try:
        block = int(receipt.get("blockNumber"), 16)
    except (TypeError, ValueError):
        return False
    if block > max_block:
        return False
    logs = receipt.get("logs") if isinstance(receipt.get("logs"), list) else []

    def from_usdc(log: Any) -> bool:
        return isinstance(log, dict) and _eq(log.get("address"), BASE_USDC) and isinstance(log.get("topics"), list) and log.get("removed") is not True

    def topics(log: dict[str, Any], n: int) -> list[Any]:
        t = log["topics"]
        return t if len(t) >= n else []

    used = any(
        from_usdc(lg) and len(topics(lg, 3)) >= 3 and _eq(lg["topics"][0], AUTHORIZATION_USED_TOPIC) and _eq(lg["topics"][1], _pad32(rec.from_)) and _eq(lg["topics"][2], rec.nonce)
        for lg in logs
    )

    def transfer_ok(lg: Any) -> bool:
        if not (from_usdc(lg) and len(topics(lg, 3)) >= 3 and _eq(lg["topics"][0], TRANSFER_TOPIC) and _eq(lg["topics"][1], _pad32(rec.from_)) and _eq(lg["topics"][2], _pad32(rec.pay_to))):
            return False
        try:
            return int(lg.get("data"), 16) == int(rec.amount)
        except (TypeError, ValueError):
            return False

    return used and any(transfer_ok(lg) for lg in logs)


@dataclass
class _View:
    used: bool
    block_ts: int = 0  # timestamp of the block the state was read at
    tx: tuple[str, int] | None = None
    window_exceeded: bool = False


def _view_at(transport: Transport, url: str, rec: PaymentRecord, tag: str, max_log_blocks: int) -> _View:
    if url not in _chain_checked:
        if not _eq(_rpc(transport, url, "eth_chainId", []), BASE_CHAIN_ID_HEX):
            raise _RpcError("wrong chain id")
        _chain_checked.add(url)
    block = _rpc(transport, url, "eth_getBlockByNumber", [tag, False])
    if not isinstance(block, dict) or not isinstance(block.get("number"), str):
        raise _RpcError("no block at tag")
    tag_block = int(block["number"], 16)
    if not isinstance(block.get("timestamp"), str):
        raise _RpcError("no block timestamp")
    tag_ts = int(block["timestamp"], 16)
    data = AUTHORIZATION_STATE_SELECTOR + _pad32(rec.from_)[2:] + rec.nonce.lower()[2:]
    # Read the state at exactly the block whose timestamp we hold, not at the moving tag.
    out = _rpc(transport, url, "eth_call", [{"to": BASE_USDC, "data": data}, hex(tag_block)])
    if not isinstance(out, str) or not out.startswith("0x"):
        raise _RpcError("bad eth_call result")
    used = int(out, 16) != 0 if out != "0x" else False
    if not used:
        return _View(False, tag_ts)
    candidates: list[str] = [rec.tx_hash_hint.lower()] if is_tx_hash(rec.tx_hash_hint) else []
    exceeded = False
    if not candidates:
        earliest = (rec.created_at or rec.valid_after or rec.valid_before - 3600) - 120
        span = max(10, math.ceil((tag_ts - earliest) / 2) + 10)
        if span > max_log_blocks:
            exceeded = True
        else:
            frm = max(0, tag_block - span)
            logs = _rpc(
                transport,
                url,
                "eth_getLogs",
                [{"address": BASE_USDC, "topics": [AUTHORIZATION_USED_TOPIC, _pad32(rec.from_), rec.nonce.lower()], "fromBlock": hex(frm), "toBlock": hex(tag_block)}],
            )
            for lg in logs if isinstance(logs, list) else []:
                if isinstance(lg, dict) and is_tx_hash(lg.get("transactionHash")):
                    candidates.append(lg["transactionHash"].lower())
    for h in candidates[:3]:
        receipt = _rpc(transport, url, "eth_getTransactionReceipt", [h])
        if receipt_proves_payment(receipt, rec, tag_block):
            return _View(True, tag_ts, (h, int(receipt["blockNumber"], 16)))
    return _View(True, tag_ts, None, exceeded)


def _bad_record(rec: Any) -> str | None:
    if not isinstance(rec, PaymentRecord):
        return "no_record"
    if rec.network != BASE_MAINNET or not _eq(rec.asset, BASE_USDC):
        return "unsupported_network_or_asset"
    if not (is_address(rec.from_) and is_address(rec.pay_to) and is_bytes32(rec.nonce) and is_atomic_amount(rec.amount)):
        return "invalid_record"
    if type(rec.valid_before) is not int or rec.valid_before <= 0:
        return "invalid_record"
    return None


def rpc_list_of(rpcs: Sequence[str] = DEFAULT_BASE_RPCS, extra_rpc: str | None = None) -> list[str]:
    """The RPC URLs a check uses: ``rpcs`` (or the defaults) plus ``extra_rpc``. More than three raises ValueError."""
    urls = list(rpcs)
    if isinstance(extra_rpc, str) and extra_rpc:
        urls.append(extra_rpc)
    if len(urls) > MAX_RPCS:
        raise ValueError(
            f"onchain: at most {MAX_RPCS} RPCs are supported (rpcs plus extra_rpc), got {len(urls)}. "
            "Pass two or three RPC URLs on different hosts."
        )
    return urls


def _views_at(t: Transport, urls: list[str], rec: PaymentRecord, tag: str, max_log_blocks: int) -> list[_View]:
    out: list[_View] = []
    for u in urls:
        try:
            out.append(_view_at(t, u, rec, tag, max_log_blocks))
        except _RpcError:
            continue
    return out


def check_payment_state(
    rec: PaymentRecord,
    *,
    rpcs: Sequence[str] = DEFAULT_BASE_RPCS,
    extra_rpc: str | None = None,
    confirm_tag: Literal["safe", "finalized"] = "safe",
    expiry_tag: Literal["safe", "finalized"] = "safe",
    margin_seconds: float = 60,
    max_log_blocks: int = 9000,
    timeout: float = 5.0,
    transport: Transport | None = None,
    now: Callable[[], float] | None = None,
) -> PaymentState:
    """Read-only check of whether one EIP-3009 payment settled. Two (or three) RPCs on different hosts.

    Quorum: both of two, or two of three (with ``extra_rpc`` or three ``rpcs``), must answer and agree.

    - "settled": a quorum shows the authorization used at ``confirm_tag`` and the same receipt with
      AuthorizationUsed(from, nonce) plus Transfer(from, payTo, amount) from the pinned USDC contract.
    - "expired_unsettled": now > validBefore + margin, no answering RPC shows it used, and a quorum shows it unused
      at a block (at ``expiry_tag``, default "safe") whose timestamp is >= validBefore + margin. ``margin_seconds``
      (default 60, minimum 30) is the margin (extra wait after ``validBefore``); ``expiry_tag="finalized"`` is more conservative (20+ min).
    - otherwise "unknown" with ``wait_until``. Never retry or sign a new payment for the purchase on "unknown".
    """
    margin = margin_of(margin_seconds)
    vb = getattr(rec, "valid_before", None)
    wait_until = vb + margin if type(vb) is int else None
    urls = rpc_list_of(rpcs, extra_rpc)
    hosts = [try_host_of(u) or "invalid" for u in urls]
    t = transport or _default_transport(timeout)
    try:
        bad = _bad_record(rec)
        if bad:
            return _unknown(bad, wait_until, hosts)
        if wait_until is None:
            return _unknown("invalid_record", wait_until, hosts)
        if len(urls) < 2 or "invalid" in hosts or len(set(hosts)) != len(hosts):
            return _unknown("need_two_rpcs_on_different_hosts", wait_until, hosts)
        quorum = 2
        views = _views_at(t, urls, rec, confirm_tag, max_log_blocks)
        if len(views) < quorum:
            return _unknown("rpc_error", wait_until, hosts)
        used = [v for v in views if v.used]
        if used:
            by_hash: dict[str, list[int]] = {}
            for v in used:
                if v.tx:
                    by_hash.setdefault(v.tx[0], []).append(v.tx[1])
            for h, blocks in by_hash.items():
                if len(blocks) >= quorum:
                    return PaymentState("settled", hosts, tx_hash=h, block_number=min(blocks), tag=confirm_tag)
            if len(used) != len(views):
                return _unknown("rpcs_disagree", wait_until, hosts)
            return _unknown("log_window_exceeded_pass_tx_hash" if any(v.window_exceeded for v in used) else "used_but_transfer_not_matched", wait_until, hosts)
        current = (now or time.time)()
        if current <= wait_until:
            return _unknown("not_settled_yet", wait_until, hosts)
        exp = views if expiry_tag == confirm_tag else _views_at(t, urls, rec, expiry_tag, max_log_blocks)
        if len(exp) < quorum:
            return _unknown("rpc_error", wait_until, hosts)
        if any(v.used for v in exp):
            return _unknown("used_but_not_confirmed" if all(v.used for v in exp) else "rpcs_disagree", wait_until, hosts)
        past = [v for v in exp if v.block_ts >= wait_until]
        if len(past) >= quorum:
            return PaymentState("expired_unsettled", hosts, valid_before=rec.valid_before)
        # The blocks read are not yet past validBefore + margin: a late settlement could still be invisible to them.
        lag = max([0.0] + [current - v.block_ts for v in exp])
        return _unknown("chain_not_past_expiry", int(max(wait_until, current) + math.ceil(min(lag, 86_400))), hosts)
    except Exception:  # noqa: BLE001
        return _unknown("check_error", wait_until, hosts)


async def acheck_payment_state(rec: PaymentRecord, **kwargs: Any) -> PaymentState:
    """Async wrapper of :func:`check_payment_state` (runs in a worker thread so it never blocks the event loop)."""
    return await asyncio.to_thread(check_payment_state, rec, **kwargs)

