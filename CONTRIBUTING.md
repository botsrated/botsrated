# Contributing

Thanks for helping. This repository holds the open-source parts of BotsRated: the client libraries and framework
integrations under [`integrations/`](integrations/), the receipt format and verifier under [`spec/`](spec/), and the
docs for the hosted MCP server. The hosted service itself (botsrated.com) is not in this repository.

## Ways To Help

- **Bugs:** open an issue with the [bug report form](https://github.com/botsrated/botsrated/issues/new/choose).
- **Security issues:** do not open a public issue. See [SECURITY.md](SECURITY.md).
- **Wrong data about a seller or MCP server:** use https://botsrated.com/disputes (free). It is re-tested and the
  reply is published next to the data.
- **Pull requests:** welcome for the integrations, the spec and the docs. For anything larger than a small fix,
  please open an issue first so we can agree on the approach.

## Layout

| Folder | Package | Language |
|---|---|---|
| `integrations/python-core` | `botsrated` (PyPI) | Python >= 3.10 |
| `integrations/langchain` | `langchain-botsrated` (PyPI) | Python |
| `integrations/llamaindex` | `llama-index-tools-botsrated` (PyPI) | Python |
| `integrations/microsoft-agent-framework` | `agent-framework-botsrated` (PyPI) | Python |
| `integrations/x402-client` | `@botsrated/x402-preflight` (npm) | TypeScript |
| `integrations/vercel-ai-sdk` | `@botsrated/ai-sdk` (npm) | TypeScript |
| `integrations/haystack`, `integrations/strands` | guides (no package) | Python |
| `spec` | receipt format and `verify.mjs` | Markdown, JavaScript |

## Running The Tests

The default tests are offline: HTTP calls are mocked and nothing is paid.

Python (from the repository root):

```bash
python -m venv .venv && . .venv/bin/activate
pip install pytest respx pytest-asyncio langchain-tests ruff
pip install -e "integrations/python-core[x402]" -e integrations/langchain -e integrations/llamaindex -e integrations/microsoft-agent-framework
(cd integrations/python-core && pytest -m "not live" tests)
(cd integrations/langchain && pytest -m "not live" tests)
(cd integrations/llamaindex && pytest -m "not live" tests)
(cd integrations/microsoft-agent-framework && pytest -m "not live" tests)
```

TypeScript:

```bash
cd integrations/x402-client && npm ci && npm run typecheck && npm test
cd integrations/vercel-ai-sdk && npm ci && npm run typecheck && npm test
```

Live tests (`pytest -m live`, the Haystack and Strands smoke scripts) call the real, free BotsRated API. They never
pay, but they need network access.

## Rules For Changes

- Keep the payment code fail-closed: when in doubt, block the payment and say why.
- Never add code that signs anything other than a quote rebuilt from allowlisted fields.
- Add or update a test for every behavior change.
- Python: `ruff check` must pass. TypeScript: `npm run typecheck` must pass.
- Add a line to [CHANGELOG.md](CHANGELOG.md) under "Unreleased" for anything users can notice.
- Results are facts, not opinions: wording in docs and tool descriptions must not endorse or accuse any seller.

## AI-Assisted Contributions

AI-assisted changes are welcome. Say so in the pull request, and only open it once you have read and tested the
change yourself.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
