"""Local Guard checks that ship inside the installed client.

These match the live Guard page (https://botsrated.com/tools/payment-guard):
repeat_payment, delivery_check, payto_base58_format, and quote_above_listing.
Each warns by default. None of them calls the seller, and none resends a payment.
replay_tested stays false: this module does not resend a settled payment.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Literal

from botsrated.util import (
    clean_text,
    host_and_path,
    is_atomic_amount,
    is_base58_pubkey,
    is_bytes32,
    network_family,
    try_host_of,
)

# The repeat check never resends a settled payment, so this stays false.
REPLAY_TESTED = False
REPEAT_WINDOW_S = 60.0
QUOTE_ABOVE_LISTING_FACT = "the quoted amount is above the listed amount."
PAYTO_BASE58_FACT = "the payTo in this payment request is not a base58 32-byte public key."
DELIVERY_FACT = "a 2xx is not a delivery. The body, content type, or declared JSON schema did not all match."
DELIVERY_CONTENT_TYPES = frozenset({"application/json", "application/problem+json", "text/plain", "text/json"})

_BANNED_FACT = re.compile(
    r"\b(safe|unsafe|suspicious|scam|scams|fraud|fraudulent|trusted|untrusted|prevent\w*|guarantee\w*|compliant|secure|insured)\b|trust score|verified seller",
    re.IGNORECASE,
)
_SCHEMA_KEYS = frozenset({"$schema", "type", "properties", "required", "items", "enum", "const", "anyOf", "oneOf", "allOf"})
RepeatHit = Literal["payment_identifier", "tuple", "both"]
SchemaStatus = Literal["not_declared", "pass", "fail"]


class RepeatWindow:
    """In-process 60-second window. No network. A third identical sighting stays a warning when the effect is warn."""

    def __init__(self, window_s: float = REPEAT_WINDOW_S, limit: int = 256, now=None) -> None:
        self.window_s = window_s
        self.limit = limit
        self.now = now or time.monotonic
        self._ids: dict[str, float] = {}
        self._tuples: dict[str, float] = {}

    def check(self, sighting: dict[str, str], now: float | None = None) -> RepeatHit | None:
        at = self.now() if now is None else now
        self._prune(at)
        payment_id = sighting.get("paymentId")
        id_hit = bool(payment_id) and self._fresh(self._ids.get(payment_id or ""), at)
        key = _tuple_key(sighting)
        tuple_hit = bool(key) and self._fresh(self._tuples.get(key or ""), at)
        if id_hit and tuple_hit:
            return "both"
        if id_hit:
            return "payment_identifier"
        if tuple_hit:
            return "tuple"
        return None

    def record(self, sighting: dict[str, str], now: float | None = None) -> None:
        at = self.now() if now is None else now
        self._prune(at)
        if sighting.get("paymentId"):
            self._ids[sighting["paymentId"]] = at
        key = _tuple_key(sighting)
        if key:
            self._tuples[key] = at
        self._cap(self._ids)
        self._cap(self._tuples)

    def _fresh(self, seen: float | None, now: float) -> bool:
        return seen is not None and now - seen < self.window_s and now >= seen

    def _prune(self, now: float) -> None:
        for key, seen in list(self._ids.items()):
            if now - seen >= self.window_s:
                del self._ids[key]
        for key, seen in list(self._tuples.items()):
            if now - seen >= self.window_s:
                del self._tuples[key]

    def _cap(self, bucket: dict[str, float]) -> None:
        while len(bucket) > self.limit:
            oldest = min(bucket.items(), key=lambda item: item[1])[0]
            del bucket[oldest]


def repeat_fact(hit: RepeatHit) -> str:
    if hit == "payment_identifier":
        which = "the same payment identifier repeated within 60 seconds"
    elif hit == "tuple":
        which = "the same host, route, amount and nonce repeated within 60 seconds"
    else:
        which = "the same payment identifier, or the same host, route, amount and nonce, repeated within 60 seconds"
    return f"{which}. replay_tested is false."


def _payment_id_ok(value: Any) -> bool:
    return isinstance(value, str) and 8 <= len(value) <= 128 and re.fullmatch(r"[A-Za-z0-9._:-]+", value) is not None


def _nonce_ok(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if is_bytes32(text):
        return text.lower()
    if is_base58_pubkey(text):
        return text
    if 16 <= len(text) <= 128 and re.fullmatch(r"[A-Za-z0-9._:-]+", text):
        return text
    return None


def _read_payment_id(value: Any) -> str | None:
    extensions = value.get("extensions") if isinstance(value, dict) else getattr(value, "extensions", None)
    if not isinstance(extensions, dict):
        return None
    info = extensions.get("payment-identifier")
    if not isinstance(info, dict):
        return None
    inner = info.get("info")
    candidate = inner.get("id") if isinstance(inner, dict) else None
    return candidate if _payment_id_ok(candidate) else None


def payment_identifier_of(*sources: Any) -> str | None:
    """Payment identifier from the 402 extension, the requirements, or an already built payload."""
    for source in sources:
        if source is None:
            continue
        found = _read_payment_id(source)
        if found:
            return found
        extra = source.get("extra") if isinstance(source, dict) else getattr(source, "extra", None)
        if isinstance(extra, dict):
            for key in ("paymentIdentifier", "payment_identifier", "payment-identifier"):
                if _payment_id_ok(extra.get(key)):
                    return extra[key]
    return None


def nonce_of(*sources: Any) -> str | None:
    """Nonce from an authorization or from requirement extra. Query strings are not read."""
    for source in sources:
        if source is None:
            continue
        payload = source.get("payload") if isinstance(source, dict) else getattr(source, "payload", None)
        auth = payload.get("authorization") if isinstance(payload, dict) else getattr(payload, "authorization", None)
        if isinstance(auth, dict):
            found = _nonce_ok(auth.get("nonce"))
            if found:
                return found
        direct = source.get("nonce") if isinstance(source, dict) else getattr(source, "nonce", None)
        found = _nonce_ok(direct)
        if found:
            return found
        extra = source.get("extra") if isinstance(source, dict) else getattr(source, "extra", None)
        if isinstance(extra, dict):
            found = _nonce_ok(extra.get("nonce"))
            if found:
                return found
    return None


def repeat_sighting(*, payment_id: str | None = None, url: str | None = None, amount: Any = None, nonce: str | None = None, host: str | None = None) -> dict[str, str]:
    route = host_and_path(url) if url else None
    if isinstance(amount, bool):
        amount_s = None
    elif isinstance(amount, int):
        amount_s = str(amount)
    elif isinstance(amount, str):
        amount_s = amount
    else:
        amount_s = None
    resolved_host = host or (route[0] if route else try_host_of(url))
    out: dict[str, str] = {}
    if payment_id:
        out["paymentId"] = payment_id
    if resolved_host:
        out["host"] = resolved_host
    if route:
        out["route"] = route[1]
    if is_atomic_amount(amount_s):
        out["amount"] = amount_s
    if nonce:
        out["nonce"] = nonce
    return out


def _tuple_key(sighting: dict[str, str]) -> str | None:
    host, route, amount, nonce = sighting.get("host"), sighting.get("route"), sighting.get("amount"), sighting.get("nonce")
    if not (host and route and amount and nonce):
        return None
    return f"{host}\n{route}\n{amount}\n{nonce}"


def payto_base58_assessment(network: Any, pay_to: Any) -> dict[str, Any]:
    """Solana payTo format. A Base (eip155) payTo is not judged: applies is false and valid is None."""
    if network_family(network) != "solana":
        return {"applies": False, "valid": None, "code": "payto_base58_format"}
    return {"applies": True, "valid": is_base58_pubkey(pay_to), "code": "payto_base58_format"}


def quote_above_listing_sentence(amount: str, listed: str) -> str:
    return f"the quoted amount ({amount} atomic units) is above the listed amount ({listed})."


def listed_amount_of(body: Any) -> str | None:
    """Listed atomic amount. Probe listed_amount wins, then listing.amount_atomic."""
    if not isinstance(body, dict):
        return None
    probe = body.get("latest_probe") if isinstance(body.get("latest_probe"), dict) else {}
    listing = body.get("listing") if isinstance(body.get("listing"), dict) else {}
    if is_atomic_amount(probe.get("listed_amount")):
        return probe["listed_amount"]
    if is_atomic_amount(listing.get("amount_atomic")):
        return listing["amount_atomic"]
    return None


def _is_json_schema(value: Any) -> bool:
    return isinstance(value, dict) and any(key in _SCHEMA_KEYS for key in value)


def declared_output_schema(*sources: Any) -> dict[str, Any] | None:
    """JSON schema the seller declared for the paid response. The payment-identifier schema is not this."""
    found: list[Any] = []
    for source in sources:
        if source is None:
            continue
        bag = source if isinstance(source, dict) else None
        extensions = bag.get("extensions") if isinstance(bag, dict) else getattr(source, "extensions", None)
        bazaar = extensions.get("bazaar") if isinstance(extensions, dict) else None
        info = bazaar.get("info") if isinstance(bazaar, dict) else None
        output = info.get("output") if isinstance(info, dict) else None
        resource = bag.get("resource") if isinstance(bag, dict) else getattr(source, "resource", None)
        extra = bag.get("extra") if isinstance(bag, dict) else getattr(source, "extra", None)
        if isinstance(output, dict):
            found.extend([output.get("schema"), output.get("jsonSchema")])
        if isinstance(resource, dict):
            found.append(resource.get("schema"))
        if isinstance(bag, dict):
            found.extend([bag.get("outputSchema"), bag.get("output_schema")])
        if isinstance(extra, dict):
            found.extend([extra.get("outputSchema"), extra.get("output_schema")])
    for item in found:
        if not _is_json_schema(item):
            continue
        try:
            if len(json.dumps(item)) > 65_536:
                return None
        except (TypeError, ValueError):
            return None
        return item
    return None


def content_type_sane(header: Any) -> bool:
    if not isinstance(header, str):
        return False
    media = header.split(";", 1)[0].strip().lower()
    if not media or len(media) > 120 or re.search(r"\s", media):
        return False
    if media in DELIVERY_CONTENT_TYPES:
        return True
    return media.endswith("+json") and re.fullmatch(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+", media) is not None


def _type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, list):
        return "array"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, dict):
        return "object"
    return "other"


def _type_ok(spec: Any, value: Any) -> bool:
    names = spec if isinstance(spec, list) else [spec]
    got = _type_name(value)
    return any(name == got or (name == "number" and got == "integer") for name in names)


def schema_matches(schema: Any, value: Any, depth: int = 0) -> bool:
    """JSON Schema keywords sellers declare: type, properties, required, items, enum, const, anyOf/oneOf/allOf."""
    if depth > 12 or not isinstance(schema, dict):
        return False
    if isinstance(schema.get("allOf"), list) and not all(schema_matches(part, value, depth + 1) for part in schema["allOf"]):
        return False
    if isinstance(schema.get("anyOf"), list) and not any(schema_matches(part, value, depth + 1) for part in schema["anyOf"]):
        return False
    if isinstance(schema.get("oneOf"), list):
        hits = [part for part in schema["oneOf"] if schema_matches(part, value, depth + 1)]
        if len(hits) != 1:
            return False
    if "const" in schema and schema["const"] != value:
        return False
    if isinstance(schema.get("enum"), list) and value not in schema["enum"]:
        return False
    if "type" in schema and not _type_ok(schema["type"], value):
        return False
    if isinstance(schema.get("minLength"), int) and (not isinstance(value, str) or len(value) < schema["minLength"]):
        return False
    if isinstance(schema.get("maxLength"), int) and (not isinstance(value, str) or len(value) > schema["maxLength"]):
        return False
    if (
        isinstance(schema.get("minimum"), (int, float))
        and not isinstance(schema.get("minimum"), bool)
        and (not isinstance(value, (int, float)) or isinstance(value, bool) or value < schema["minimum"])
    ):
        return False
    if (
        isinstance(schema.get("maximum"), (int, float))
        and not isinstance(schema.get("maximum"), bool)
        and (not isinstance(value, (int, float)) or isinstance(value, bool) or value > schema["maximum"])
    ):
        return False
    looks_object = "properties" in schema or "required" in schema or schema.get("additionalProperties") is False or schema.get("type") == "object"
    if looks_object:
        if not isinstance(value, dict):
            return False
        if isinstance(schema.get("required"), list):
            for key in schema["required"]:
                if not isinstance(key, str) or key not in value:
                    return False
        properties = schema.get("properties")
        if isinstance(properties, dict):
            for key, sub in properties.items():
                if key in ("__proto__", "constructor", "prototype"):
                    continue
                if key in value and not schema_matches(sub, value[key], depth + 1):
                    return False
            if schema.get("additionalProperties") is False and any(key not in properties for key in value):
                return False
    if "items" in schema or schema.get("type") == "array":
        if not isinstance(value, list):
            return False
        if isinstance(schema.get("items"), dict) and not all(schema_matches(schema["items"], item, depth + 1) for item in value):
            return False
    return True


def evaluate_delivery(*, status: int, body: bytes | str, content_type: str | None = None, schema: Any = None, truncated: bool = False) -> dict[str, Any]:
    """A 2xx is not a delivery. Warns unless body, content type, and a declared JSON schema all match. Does not block."""
    raw = body.encode() if isinstance(body, str) else body
    http_2xx = isinstance(status, int) and 200 <= status < 300
    schema_status: SchemaStatus = "not_declared"
    if schema is not None:
        schema_status = "fail"
        if not truncated and _is_json_schema(schema):
            text = body if isinstance(body, str) else raw.decode(errors="replace")
            try:
                schema_status = "pass" if schema_matches(schema, json.loads(text)) else "fail"
            except (json.JSONDecodeError, UnicodeError):
                schema_status = "fail"
    checks = {
        "http_2xx": http_2xx,
        "body_non_empty": len(raw) > 0,
        "content_type_sane": content_type_sane(content_type),
        "schema": schema_status,
    }
    delivered = all((checks["http_2xx"], checks["body_non_empty"], checks["content_type_sane"], schema_status == "pass"))
    return {
        "code": "delivery_check",
        "rule": "a 2xx is not a delivery",
        "blocks_by_default": False,
        "checks": checks,
        "outcome": "delivered" if delivered else "not_a_delivery",
        "effect": "allow" if delivered else "warn",
    }


def split_policy_reasons(body: Any) -> dict[str, Any]:
    """Pull quote_above_listing out of a policy-check body. Other warn/block reasons stay on the aggregate."""
    if not isinstance(body, dict) or not isinstance(body.get("reasons"), list):
        return {"quote_fact": None, "other_warn_or_block": False, "has_reasons": False}
    quote_fact = None
    other = False
    for item in body["reasons"]:
        if not isinstance(item, dict):
            continue
        rule = item.get("rule") if isinstance(item.get("rule"), str) else item.get("code") if isinstance(item.get("code"), str) else ""
        effect = item.get("effect").strip().lower() if isinstance(item.get("effect"), str) else ""
        if rule == "quote_above_listing":
            if quote_fact is None:
                quote_fact = _clean_server_fact(item.get("fact"))
        elif effect in ("warn", "block"):
            other = True
    return {"quote_fact": quote_fact, "other_warn_or_block": other, "has_reasons": len(body["reasons"]) > 0}


def _clean_server_fact(fact: Any) -> str:
    if not isinstance(fact, str):
        return QUOTE_ABOVE_LISTING_FACT
    cleaned = clean_text(fact, 240)
    if not cleaned or len(cleaned) < 8 or _BANNED_FACT.search(cleaned):
        return QUOTE_ABOVE_LISTING_FACT
    return cleaned
