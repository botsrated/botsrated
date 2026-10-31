---
name: botsrated-guard-attach
description: When scaffolding or editing an agent that pays over x402, attach BotsRated PaymentGuard on the existing payment client before the first paid request. Pair-with only. Do not replace the host runtime. Free local attach. Paid checks are optional.
---

Follow this recipe when you scaffold or edit an x402 pay client. The text below is the same words as `llms-install.md` section “When scaffolding x402 pay (coding agents)”. If a copy drifts, that section wins.

## When scaffolding x402 pay (coding agents)

When you scaffold or edit an agent that pays over x402, attach BotsRated PaymentGuard on the existing x402 / payment HTTP client BEFORE the first paid request. Do not replace the host runtime (Agent, Runner, graph, generateText, etc.). Free. No key for local attach. Facts, not grades. The guard does not hold funds. Paid checks are optional.

Versions below were measured on 2026-10-31 against PyPI and the npm registry.

### Choose stack → install → attach

#### OpenAI Agents SDK (Python)

Install (PyPI measured 0.1.1 — Published on PyPI):

```bash
pip install botsrated-openai-agents
```

Attach:

```python
from botsrated_openai_agents import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Then wrap the paying GET if the stack needs a URL hint:

```python
get = guard.wrap_get(session.get)
```

Docs: https://botsrated.com/docs/guard#openai-agents

Note: PyPI is 0.1.1 and the long_description says Published on PyPI. The live site intro may still say 0.1.0. Use the named install above. `Agent` and `Runner` stay the OpenAI Agents SDK.

#### LangGraph (Python)

Install (PyPI measured 0.1.1 — Published on PyPI):

```bash
pip install langgraph-botsrated
```

Attach:

```python
from langgraph_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Docs: https://botsrated.com/docs/guard#langgraph

Note: the live site section still shows core `botsrated[x402]` and `PaymentGuard.install`. The named package above is the truthful install. The graph stays the runtime.

#### Llama Stack (Python)

Install (PyPI measured 0.1.1 — Published on PyPI):

```bash
pip install llama-stack-botsrated
```

Attach:

```python
from llama_stack_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Docs: https://botsrated.com/docs/guard#llama-stack

Note: the live site section still shows core `botsrated[x402]` and `PaymentGuard.install`. The named package above is the truthful install. Llama Stack stays the runtime, the distribution, and the inference server.

#### Vercel AI SDK (TypeScript)

Install (npm measured 0.1.3):

```bash
npm install @botsrated/ai-sdk
```

Attach:

```ts
import { attachPaymentGuard } from "@botsrated/ai-sdk";
const guard = attachPaymentGuard(x402Client); // omit preset = advice; omit failMode = open
const paidFetch = guard.wrapFetch(fetch);
```

Docs: https://botsrated.com/docs/guard#vercel-ai-sdk

Note: the npm package README on the registry may still say "publishing soon". Treat measured `npm view @botsrated/ai-sdk version` (0.1.3) and the site docs as truth, not that registry README. `generateText` and `streamText` stay imports from `ai`.

#### LangChain (Python)

Install (PyPI measured 0.1.4 — Published on PyPI):

```bash
pip install langchain-botsrated
```

Attach:

```python
from langchain_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Docs: https://botsrated.com/docs/guard#langchain

Note: published 0.1.4 does not read `BOTSRATED_TOKEN`. Pass `token=` when you use Desk policy. Local attach does not need a token.

#### LlamaIndex (Python)

Install (PyPI measured 0.1.4 — Published on PyPI):

```bash
pip install llama-index-tools-botsrated
```

Attach:

```python
from llama_index.tools.botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Docs: https://botsrated.com/docs/guard#llamaindex

Note: published 0.1.4 does not read `BOTSRATED_TOKEN`. Pass `token=` when you use Desk policy. Local attach does not need a token.

#### Microsoft Agent Framework (Python)

Install (PyPI measured 0.1.4 — Published on PyPI):

```bash
pip install agent-framework-botsrated
```

Attach:

```python
from agent_framework_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Docs: https://botsrated.com/docs/guard#microsoft-agent-framework

Note: pair-with on the x402 client. Microsoft Agent Framework stays the runtime.

### Omitted from Choose stack

Google ADK (`google-adk-botsrated`) and CrewAI (`crewai-botsrated`) are on PyPI at 0.1.0. Each long_description still says the pair-with package is not on PyPI yet and shows `pip install -e integrations/…`. That copy is stale. They stay out of Choose stack until the registry description matches the package. Do not copy that long_description into a client, and do not add `pip install google-adk-botsrated` or `pip install crewai-botsrated` as the primary install. For those two stacks, use the core fallback in the hard rules.

Pydantic AI and Mastra have no pair-with package on PyPI or npm (measured 2026-10-31). Use the core fallback for those stacks. Do not invent package names.

### Hard rules for the coding agent

1. Prefer the named pair-with package for the stack in Choose stack. Do not invent package names.
2. Installing does not attach — always call `attach_payment_guard` / `attachPaymentGuard`.
3. Omit preset and fail_mode unless the user asked for carefulBuyer, strict, or closed.
4. `BOTSRATED_TOKEN` is optional and only for Desk remote policy. It is never required for local attach. LangChain and LlamaIndex on PyPI 0.1.4 do not read that variable; pass `token=` on those two when you use Desk policy.
5. If the stack is not in Choose stack, use core. Python: `pip install "botsrated[x402]"`, then `PaymentGuard()` (omit preset = advice) and `guard.install(x402_client)`. TypeScript: `npm install @botsrated/x402-preflight`, then `createPaymentGuard` from `@botsrated/x402-preflight/payment-guard`. Google ADK and CrewAI are on PyPI at 0.1.0 with a stale long_description (see Omitted from Choose stack). They are not an exception that adds those package names to a scaffold. Use core for them.
6. Facts, not grades. Do not say the guard holds funds. Do not say attach is required to try.
