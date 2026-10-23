import json
from botsrated_strands_tool import botsrated_check_payment

ok = json.loads(botsrated_check_payment("https://blockrun.ai/api/v1/chat/completions", "0xe9030014F5DAe217d0A152f02A043567b16c1aBf", "2000"))
bad = json.loads(botsrated_check_payment("https://blockrun.ai/api/v1/chat/completions", "0x000000000000000000000000000000000000dEaD", "2000"))
print(ok["action"], bad["action"], bad["reasons"][0]["code"])
print(botsrated_check_payment.tool_name, list(botsrated_check_payment.tool_spec["inputSchema"]["json"]["properties"]))
