"""botsrated.attach: the one shared attach_payment_guard, and a check that the framework copies still match it."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import pytest

from botsrated import attach as attach_mod
from botsrated.attach import attach_payment_guard, build_payment_guard
from botsrated.payment_guard import POLICIES, PaymentGuard

INTEGRATIONS = Path(__file__).resolve().parents[2]

# The nine framework packages that still carry their own copy until they depend on a core release with this module.
COPIES = [
    "crewai/src/crewai_botsrated/guard.py",
    "google-adk/src/google_adk_botsrated/guard.py",
    "langgraph/src/langgraph_botsrated/guard.py",
    "llama-stack/src/llama_stack_botsrated/guard.py",
    "microsoft-agent-framework/src/agent_framework_botsrated/guard.py",
    "openai-agents/src/botsrated_openai_agents/guard.py",
    "pydantic-ai/src/pydantic_ai_botsrated/guard.py",
    "langchain/langchain_botsrated/attach.py",
    "llamaindex/llama_index/tools/botsrated/attach.py",
]
# This one takes the token only as an argument and says so in its README. Core's read_env=False is for it.
NO_ENV_TOKEN = {"llamaindex/llama_index/tools/botsrated/attach.py"}


class Recorder:
    """Stands in for PaymentGuard: keeps the keyword arguments and the client it was installed on."""

    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs
        self.installed_on: Any = None

    def install(self, client: Any) -> None:
        self.installed_on = client


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> type[Recorder]:
    monkeypatch.setattr(attach_mod, "PaymentGuard", Recorder)
    monkeypatch.delenv("BOTSRATED_TOKEN", raising=False)
    return Recorder


def test_no_choices_builds_the_default_guard_and_makes_no_policy_call(recorder):
    assert build_payment_guard().kwargs == {}


def test_strict_is_the_strict_rule_table_and_other_presets_pass_by_name(recorder):
    assert build_payment_guard(preset="strict").kwargs == {"policy": POLICIES["strict"]}
    assert build_payment_guard(preset="warn").kwargs == {"preset": "warn"}
    assert build_payment_guard(preset="carefulBuyer").kwargs == {"preset": "carefulBuyer"}


def test_fail_mode_sets_fail_open(recorder):
    assert build_payment_guard(fail_mode="closed").kwargs == {"fail_open": False}
    assert build_payment_guard(fail_mode="open").kwargs == {"fail_open": True}


def test_token_is_sent_as_a_mapping_with_the_fail_mode(recorder):
    assert build_payment_guard(token="t").kwargs == {"remote_policy": {"token": "t", "fail_mode": "open"}}
    assert build_payment_guard(token="t", fail_mode="closed").kwargs == {
        "fail_open": False,
        "remote_policy": {"token": "t", "fail_mode": "closed"},
    }


def test_env_token_is_used_only_when_the_argument_is_omitted(recorder, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BOTSRATED_TOKEN", "from-env")
    assert build_payment_guard().kwargs["remote_policy"]["token"] == "from-env"
    assert build_payment_guard(token="explicit").kwargs["remote_policy"]["token"] == "explicit"
    assert "remote_policy" not in build_payment_guard(token="").kwargs


def test_read_env_false_never_reads_the_environment(recorder, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BOTSRATED_TOKEN", "from-env")
    assert build_payment_guard(read_env=False).kwargs == {}
    assert build_payment_guard(token="explicit", read_env=False).kwargs["remote_policy"]["token"] == "explicit"
    assert attach_payment_guard(object(), read_env=False).kwargs == {}


def test_bad_choices_raise(recorder):
    with pytest.raises(ValueError):
        build_payment_guard(preset="dry-run-only")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        build_payment_guard(fail_mode="shut")  # type: ignore[arg-type]


def test_attach_installs_on_the_client_and_returns_the_guard(recorder):
    client = object()
    guard = attach_payment_guard(client, preset="warn")
    assert guard.installed_on is client
    assert guard.kwargs == {"preset": "warn"}


def test_real_guard_is_built_for_every_choice(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("BOTSRATED_TOKEN", raising=False)
    for preset in (None, "warn", "carefulBuyer", "strict"):
        for fail_mode in (None, "open", "closed"):
            for token in (None, "policy-token-example"):
                assert isinstance(build_payment_guard(preset=preset, token=token, fail_mode=fail_mode), PaymentGuard)


def _function(tree: ast.Module, name: str) -> ast.FunctionDef | None:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    return None


def _shape(fn: ast.FunctionDef) -> str:
    """The function's code with its docstring and comments left out."""
    body = fn.body[1:] if isinstance(fn.body[0], ast.Expr) and isinstance(getattr(fn.body[0], "value", None), ast.Constant) else fn.body
    return "\n".join(ast.dump(stmt) for stmt in body)


@pytest.mark.parametrize("relative", COPIES)
def test_framework_copies_have_not_drifted_from_each_other(relative: str):
    """Until the copies are replaced by an import of this module, a fix made in one must be made in all nine."""
    reference = INTEGRATIONS / COPIES[0]
    path = INTEGRATIONS / relative
    if not reference.exists() or not path.exists():
        pytest.skip("framework packages are not in this checkout")
    ref_tree = ast.parse(reference.read_text())
    tree = ast.parse(path.read_text())
    ref_fn = _function(ref_tree, "_token_from")
    fn = _function(tree, "_token_from")
    if relative in NO_ENV_TOKEN:
        assert fn is None
        return
    assert ref_fn is not None and fn is not None
    assert _shape(fn) == _shape(ref_fn)
