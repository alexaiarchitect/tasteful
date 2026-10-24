---
type: tool_used
tool: Bash
input_match: 'probe\.mjs[^\n]*--deep'
min: 0
max: 0
---

No deep probe may run before the user approves a selection. This checks actual Bash calls, not the skill text in the trace (which legitimately documents the `--deep` command for the post-approval path).
