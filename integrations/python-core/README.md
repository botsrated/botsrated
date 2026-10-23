# botsrated (Python)

A pre-payment check for x402 agents. Before your agent pays a seller, it asks
[BotsRated](https://botsrated.com) what it has measured about that seller, using the free
`GET /v1/preflight` route. Paid lookups are opt-in and capped by a budget you set.

BotsRated is in beta. It covers about 4,800 x402 seller hosts on Base, taken from the CDP Bazaar,
Agentic.Market, 402index and x402-list. Each host gets an unpaid probe about every 5.4 h, and every
receipt is signed.

**Status: published on PyPI: [`botsrated`](https://pypi.org/project/botsrated/) 0.1.0.**

```bash
pip install botsrated            # free preflight + guard
pip install "botsrated[x402]"    # + x402 SDK hook / paid lookups
```

## Guard an x402 client (free)

```python
from x402 import x402ClientSync
from x402.mechanisms.evm import EthAccountSigner
from x402.mechanisms.evm.exact import ExactEvmScheme
from botsrated import PrePaymentGuard

client = x402ClientSync()
client.register("eip155:*", ExactEvmScheme(signer=EthAccountSigner(account)))
client.on_before_payment_creation(PrePaymentGuard().x402_hook)
```

Defaults:
- A payTo that differs from every payTo BotsRated saw for the host, on the same network, is **blocked**.
- A price above the last observed price on the same route is a warning.
- A host that is not covered is allowed.
- Data older than 24 h is allowed.
- If BotsRated cannot be reached (4 s timeout), the payment is allowed (`fail_open`).
- The minimum valid-402 rate is off.

Change these with `GuardPolicy(...)`. Preflight answers are cached for 5 minutes per host.

## Opt-in paid lookups with a budget

```python
from x402.http.clients import x402_requests
from botsrated import BotsRatedClient, PrePaymentGuard

session = x402_requests(client)                      # pays x402 challenges
botsrated = BotsRatedClient(budget_usd="0.05", paying_get=session.get)
guard = PrePaymentGuard(botsrated, paid_check_at_or_above_usd=0.25)
client.on_before_payment_creation(guard.x402_hook)

botsrated.check("seller.example")     # $0.001 (first 100/day free)
botsrated.report("seller.example")    # $0.002 (first 10/day free)
botsrated.best("web search")          # $0.01
```

How paid calls work:
- Free daily quota: the first 100 `/v1/check` and 10 `/v1/report` calls per client per UTC day are
  served free (200 with `charged: false` and a `free_quota` block). The client asks unpaid first, so
  inside the quota nothing is paid and the budget is untouched; `check()`/`report()` also work without
  a budget until the quota is used up (then `paid_disabled`). `client.last_free_quota` shows what is left.
- Otherwise the client reads the 402 quote unpaid first. It accepts only `exact` USDC on Base to BotsRated's payTo
  `0x7F936f42F46B6c4Cbd3242cF8A1759dfe829E349`, at or below the published price.
- The amount is reserved from the budget before paying and released if the call fails.
- When the guard is registered, it refuses any payment to botsrated.com that the client did not reserve.

## Tests

```bash
uv run --with pytest --with respx --with "x402[evm]" pytest
```

License: MIT. BotsRated reports measurements, not endorsements.
