# Courthouse

Static booth for one BotsRated receipt signature. Serve this folder yourself. There is no app server and no share store.

## Files

| File | Role |
|---|---|
| `index.html` | Paste a receipt link or JSON |
| `verify-booth.mjs` | Browser entry. Imports `./verify-core.mjs` |
| `verify-core.mjs` | Byte copy of [`../verify-core.mjs`](../verify-core.mjs). Same `verifyReceipt` |

Keep the three files in this directory. `verify-booth.mjs` loads `./verify-core.mjs` beside it. If `../verify-core.mjs` changes, copy it again:

```
cp spec/verify-core.mjs spec/courthouse/verify-core.mjs
```

## Serve

From this folder:

```
python3 -m http.server 8765
```

Open http://127.0.0.1:8765/ . Any static file server works. The page loads `./verify-booth.mjs` as a module.

### file://

Opening `index.html` as `file://` does not run the module. Browsers refuse that import. The status stays `signature invalid` because the check never runs. Serve the folder over HTTP on localhost or your own host.

## What a check does

Paste `https://botsrated.com/receipt/<20 hex>` or the receipt JSON.

A link is rebuilt before it is fetched. The host must be `botsrated.com`, the path must be `/receipt/` plus 20 hex characters, and the only query keys kept are `host`, `mcp`, `day`, and `s`, each checked with the same allowlists as `receiptCliUrl`. Any other host, path, userinfo, or query key is left out. The booth then requests only:

- `https://botsrated.com/.well-known/botsrated-key`
- that rebuilt receipt link, when the paste was a link
- `https://botsrated.com/dataset.json` and `https://botsrated.com/dataset.sig.json` only when the receipt has no `sig` (same rule as `verify.mjs`)

Ed25519 runs in the browser through `verifyReceipt`. The paste is not uploaded.

## Claim ceiling

The page shows one status: `signature valid`, `signature invalid`, or `key unknown`.

A matching signature checks this record only. It is not a rating of the seller.

A browser without WebCrypto Ed25519 stays on `signature invalid`. A missing key set shows `key unknown`. Nothing on this page scores a seller, stores the paste, or mints a share link.

## Soft Guard

The Attach Guard link is in the page with the `hidden` attribute. It stays off unless the page URL includes `?soft=1`. Either way, this booth does not attach a guard.
