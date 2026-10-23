"""Check x402 payments with BotsRated before a payment tool runs.

Runs without a model API key: a scripted chat client stands in for the model. It calls the
real, free BotsRated preflight (no key, no wallet). Nothing is paid; ``pay_x402`` below is a stub.

    pip install agent-framework-botsrated   # or: pip install -e .
    python examples/quickstart.py
"""

import asyncio
import json
from collections.abc import Awaitable, Mapping, Sequence
from typing import Any

from agent_framework import (
    Agent,
    BaseChatClient,
    ChatMiddlewareLayer,
    ChatResponse,
    ChatResponseUpdate,
    Content,
    FunctionInvocationLayer,
    Message,
    ResponseStream,
)
from botsrated import BotsRatedClient

from agent_framework_botsrated import DECISION_METADATA_KEY, BotsRatedPaymentMiddleware

SELLER = "https://blockrun.ai/api/v1/chat/completions"
UNKNOWN_PAY_TO = "0x000000000000000000000000000000000000dEaD"


class ScriptedModel(FunctionInvocationLayer[Any], ChatMiddlewareLayer[Any], BaseChatClient[Any]):
    """Stands in for a real chat client. Each turn is a list of (call_id, function, arguments)."""

    def __init__(self, *turns: list[tuple[str, str, dict[str, Any]]]) -> None:
        super().__init__()
        self.turns = list(turns)

    def _inner_get_response(
        self, *, messages: Sequence[Message], stream: bool = False, options: Mapping[str, Any], **kwargs: Any
    ) -> Awaitable[ChatResponse] | ResponseStream[ChatResponseUpdate, ChatResponse]:
        turn = self.turns.pop(0) if self.turns else []
        calls = [Content.from_function_call(call_id=i, name=n, arguments=json.dumps(a)) for i, n, a in turn]

        async def respond() -> ChatResponse:
            return ChatResponse(messages=[Message(role="assistant", contents=calls or [Content.from_text("Done.")])])

        return respond()


def pay_x402(url: str, pay_to: str, amount: str, network: str = "eip155:8453") -> str:
    """Pay an x402 seller (stub: a real tool would sign and send the payment here)."""
    return f"PAID {amount} to {pay_to} for {url}"


async def main() -> None:
    observed_pay_to = BotsRatedClient().preflight(SELLER).body["latest_probe"]["live_payTo"]
    model = ScriptedModel(
        [
            ("pay-unknown", "pay_x402", {"url": SELLER, "pay_to": UNKNOWN_PAY_TO, "amount": "2000"}),
            ("pay-observed", "pay_x402", {"url": SELLER, "pay_to": observed_pay_to, "amount": "2000"}),
        ]
    )
    decisions = []
    middleware = BotsRatedPaymentMiddleware(["pay_x402"])
    middleware.guard.on_decision = decisions.append
    agent = Agent(client=model, tools=[pay_x402], middleware=[middleware])

    response = await agent.run("Buy one completion from blockrun.ai.")
    for message in response.messages:
        for content in message.contents:
            if content.type == "function_result":
                print(f"{content.call_id}: {content.result}")
    for d in decisions:
        print(f"decision for {d.host}: {d.action} {[r.code for r in d.reasons]}")
    assert DECISION_METADATA_KEY == "botsrated_decision"


if __name__ == "__main__":
    asyncio.run(main())
