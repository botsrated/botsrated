# Security Policy

## Reporting A Vulnerability

Please report security issues privately, not in a public issue or pull request.

- **Email:** botsrated@gmail.com, with "Security" in the subject line.
- **GitHub:** you can also use [private vulnerability reporting](https://github.com/botsrated/botsrated/security/advisories/new) on this repository.

Please include:

- what is affected (package name and version, or the botsrated.com URL or MCP tool);
- steps to reproduce, or a proof of concept;
- what an attacker could do with it.

Please give us a reasonable chance to fix the issue before you disclose it publicly. We will credit you in the
changelog and the advisory if you want to be named.

## What Is In Scope

- The packages built from this repository: `botsrated`, `langchain-botsrated`, `llama-index-tools-botsrated` and
  `agent-framework-botsrated` (PyPI); `@botsrated/x402-preflight` and `@botsrated/ai-sdk` (npm).
- The hosted service at https://botsrated.com: the HTTP API, the remote MCP server (`/mcp`), the A2A endpoint and
  the signed receipts and keys.
- The receipt format and verifier in [`spec/`](spec/).

Issues of particular interest: anything that could make a pre-payment guard approve a payment it should block, make
a paid call sign something other than the published quote, forge or replay a BotsRated signature, or reach private
networks through BotsRated's probes or webhooks.

## Please Do Not

- run load or denial-of-service tests against botsrated.com;
- access, change or delete data that is not yours;
- send payments or probes to third-party sellers on someone else's behalf.

## Supported Versions

Fixes go into the latest published version of each package. See [CHANGELOG.md](CHANGELOG.md) for versions.

The same policy is published at https://botsrated.com/security and in
https://botsrated.com/.well-known/security.txt.

## Data Corrections

A wrong measurement about a seller or MCP server is not a security issue. Use the free dispute route instead:
https://botsrated.com/disputes.
