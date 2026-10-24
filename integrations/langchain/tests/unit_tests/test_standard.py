"""LangChain standard tool tests."""

import pytest

pytest.importorskip("langchain_tests")
from langchain_tests.unit_tests import ToolsUnitTests

from langchain_botsrated import BotsRatedPreflightTool


class TestBotsRatedPreflightStandard(ToolsUnitTests):
    @property
    def tool_constructor(self):
        return BotsRatedPreflightTool

    @property
    def tool_constructor_params(self) -> dict:
        return {}

    @property
    def tool_invoke_params_example(self) -> dict:
        return {"url": "https://blockrun.ai/api/v1/chat/completions"}
