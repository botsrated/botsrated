import json
from collections.abc import Awaitable, Mapping, Sequence
from typing import Any

import pytest
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


@pytest.fixture(autouse=True)
def _no_token_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Offline tests never read a real policy token from the environment."""
    monkeypatch.delenv("BOTSRATED_TOKEN", raising=False)


@pytest.fixture
def api():
    import respx
    from support import FOUND, NOT_COVERED

    with respx.mock(base_url="https://botsrated.com", assert_all_called=False) as mock:
        mock.get("/v1/preflight", params={"url": FOUND["host"]}).respond(200, json=FOUND)
        mock.get("/v1/preflight").respond(404, json=NOT_COVERED)
        yield mock
