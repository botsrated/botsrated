"""A Haystack tool that checks an x402 payment option with BotsRated before paying it.

Free: uses BotsRated's GET /v1/preflight (no key, no wallet). Same code as the
"Pre-payment tool" section of README.md.
"""
import json

from botsrated import BotsRatedClient, PrePaymentGuard
from haystack.tools import tool

guard = PrePaymentGuard(BotsRatedClient())  # free preflight only, nothing is paid


@tool
def botsrated_check_payment(url: str, pay_to: str, amount: str, network: str = "eip155:8453") -> str:
    """Check an x402 payment option against BotsRated's measurements BEFORE paying it.

    :param url: The seller URL you are about to pay.
    :param pay_to: The payTo address from the seller's 402 payment option.
    :param amount: The amount in atomic units from that option.
    :param network: The CAIP-2 network of that option.
    """
    d = guard.decide(url, {"scheme": "exact", "network": network, "payTo": pay_to, "amount": amount})
    return json.dumps({
        "action": d.action,
        "reasons": [{"code": r.code, "detail": r.detail} for r in d.reasons],
        "receipt_url": d.facts.receipt_url if d.facts else None,
    })
