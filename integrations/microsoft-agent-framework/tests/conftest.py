import json
from collections.abc import Awaitable, Mapping, Sequence
from typing import Any

from agent_framework import (
    BaseChatClient,
    ChatMiddlewareLayer,
    ChatResponse,
    ChatResponseUpdate,
    Content,
    FunctionInvocationLayer,
    Message,
    ResponseStream,
)


class ScriptedModel(FunctionInvocationLayer[Any], ChatMiddlewareLayer[Any], BaseChatClient[Any]):
    """A stand-in chat client. Each turn is a list of (call_id, function, arguments)."""

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


def results(response: Any) -> dict[str, Any]:
    return {c.call_id: c.result for m in response.messages for c in m.contents if c.type == "function_result"}
