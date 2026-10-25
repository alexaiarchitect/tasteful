---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill, AskUserQuestion, Write, "Bash(node *)", "Bash(bash *)"]
tags: [extract, verify, overlay]
---

The dji app has its own per-site layer at `apps/dji/src/styles/site.css`, which sits on top of our shared theme (`packages/theme/src/styles/theme.css`). Is it safe to ship against the shared theme? Use the tasteful plugin's check, tell me exactly what fails and what to change, but don't edit anything.
