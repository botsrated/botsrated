"""Smoke test: Strands MCPClient against the hosted BotsRated MCP server (free tools only, no wallet)."""
from mcp.client.streamable_http import streamable_http_client
from strands.tools.mcp import MCPClient

botsrated = MCPClient(lambda: streamable_http_client("https://botsrated.com/mcp"))
with botsrated:
    tools = botsrated.list_tools_sync()
    print([t.tool_name for t in tools])
    r = botsrated.call_tool_sync(
        tool_use_id="t1", name="preflight", arguments={"url": "https://blockrun.ai/api/v1/chat/completions"}
    )
    print(r["status"], "blockrun.ai" in str(r["content"]), "live_payTo" in str(r["content"]))
