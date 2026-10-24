# botsrated (Python)

A pre-payment check for x402 agents. Before your agent pays a seller, it asks
[BotsRated](https://botsrated.com) what it has measured about that seller, using the free
`GET /v1/preflight` route. Paid lookups are opt-in and capped by a budget you set.

BotsRated is in beta. It covers about 4,800 x402 seller hosts on Base, taken from the CDP Bazaar,
Agentic.Market, 402index and x402-list. Each host gets an unpaid probe about every 1.8 h, and every
receipt is signed.

**Status: published on PyPI: [`botsrated`](https://pypi.org/project/botsrated/) 0.1.5.**

```bash
pip install botsrated            # free preflight + guard
pip install "botsrated[x402]"    # + x402 SDK hook / paid lookups
```

## Guard an x402 client (free)

```python
from x402 import x402ClientSync
from x402.mechanisms.evm import EthAccountSigner
from x402.mechanisms.evm.exact import ExactEvmScheme
from x402.http.clients import x402_requests
from botsrated import PrePaymentGuard

client = x402ClientSync()
client.register("eip155:*", ExactEvmScheme(signer=EthAccountSigner(account)))
guard = PrePaymentGuard()
client.on_before_payment_creation(guard.x402_hook)

# Tell the guard which URL is actually being paid (since 0.1.5):
session = x402_requests(client)
paid_get = guard.wrap_get(session.get)       # or: with paying_request(url): session.get(url)
paid_get("https://seller.example/api")
```

The 402's `resource.url` is chosen by the seller, so on its own it only says which host the seller
*claims* to be. When the guard knows the request URL (`guard.wrap_get(...)`, `guard.wrap_async_get(...)`,
`with paying_request(url):`, `guard.x402_hook_for(url)`, or `guard.decide(..., request_url=url)`), it looks
up that URL's host and blocks the payment with `resource_url_mismatch` if `resource.url` names a different
host. That block applies even with `fail_open=True`. Without a request URL the host is still read from
`resource.url` (as before 0.1.5); set `GuardPolicy(require_request_url=True)` to block those payments instead.

Defaults:
- A payTo that differs from every payTo BotsRated's own probes saw for the host, on the same network, is **blocked**.
  The seller's directory listing alone never confirms a payTo: with no probe observation, a listing match is
  allowed with a `payto_listing_only` note and a listing mismatch is blocked.
- A price above the last observed price on the same route is a warning.
- A host that is not covered is allowed.
- Data older than 24 h is allowed.
- If BotsRated cannot be reached (4 s timeout), the payment is allowed (`fail_open`).
- The minimum valid-402 rate is off.

Change these with `GuardPolicy(...)`. Preflight answers are cached for 5 minutes per host.

## Opt-in paid lookups with a budget

```python
from botsrated import BotsRatedClient, PrePaymentGuard

botsrated = BotsRatedClient(budget_usd="0.05", x402_client=client)   # signs only the validated quote
guard = PrePaymentGuard(botsrated, paid_check_at_or_above_usd=0.25)
client.on_before_payment_creation(guard.x402_hook)

botsrated.check("seller.example")     # $0.001 (first 100/day free)
botsrated.report("seller.example")    # $0.002 (first 10/day free)
botsrated.best("web search")          # $0.01
```

`x402_client=` (since 0.1.4) is the recommended mode: the client validates the 402, rebuilds it from
the allowlisted fields only (scheme, network, asset, amount, payTo, maxTimeoutSeconds, EIP-3009
`name`/`version`, resource url/description/mimeType; never `extensions`), signs that copy with
`client.create_payment_payload`, and sends `PAYMENT-SIGNATURE` itself. The signer never sees the raw
402. The older `paying_get=x402_requests(client).get` still works, but that session re-reads the 402
itself, so register the guard on the same x402 client so the re-served 402 is checked again before signing.

How paid calls work:
- Free daily quota: the first 100 `/v1/check` and 10 `/v1/report` calls per client per UTC day are
  served free (200 with `charged: false` and a `free_quota` block). The client asks unpaid first, so
  inside the quota nothing is paid and the budget is untouched; `check()`/`report()` also work without
  a budget until the quota is used up (then `paid_disabled`). `client.last_free_quota` shows what is left.
- Otherwise the client reads the 402 quote unpaid first. It accepts the quote only if **every** option is `exact` USDC on Base to BotsRated's payTo
  `0x7F936f42F46B6c4Cbd3242cF8A1759dfe829E349`, at or below the published price.
- The amount is reserved from the budget before paying. If the paid call fails or raises, it stays counted
  (the payment may already have settled), so the budget is a hard ceiling.
- Amounts must be ASCII digits only (`[0-9]+`); since 0.1.5 a quote with e.g. Arabic-Indic or full-width
  digits is refused.
- Only a one-shot EIP-3009 payment is signed: an option whose `extra` holds anything beyond the token's
  `name`/`version` (e.g. `assetTransferMethod: permit2`, `paymentFlow`), a `maxTimeoutSeconds` above 600, or
  payment extensions in the 402 (e.g. `erc20ApprovalGasSponsoring`; only the discovery-only `bazaar` key is
  tolerated) rejects the quote with `terms_rejected` before anything is paid.
- With `x402_client=`, if signing fails nothing can settle and the reservation is released (`payment_not_created`).
- When the guard is registered, it refuses any payment to botsrated.com that the client did not reserve or
  that carries payment extensions, and strips extensions before the x402 signer runs.

## Tests

```bash
uv run --with pytest --with respx --with "x402[evm]" pytest
```

License: MIT. BotsRated reports measurements, not endorsements.
