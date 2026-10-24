---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill, AskUserQuestion, Write, "Bash(node *)", "Bash(bash *)"]
tags: [extract, verify, contrast]
---

Does the generated theme `.tasteful/low-contrast/theme.low-contrast.css` meet the accessibility contrast floor in both light and dark schemes? My sites CI runs Lighthouse with accessibility ≥ 95. Use the tasteful plugin's check, tell me exactly what fails and what to change, but don't edit the file.
