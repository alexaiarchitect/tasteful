---
type: llm
focus: trace
---

**What the judge can see:** the full trace — the prompt, every tool call and its output (including the `contract.mjs` report), and Claude's final message. The candidate file is the reference theme with one token, `--color-accent-soft`, renamed to `--color-accent-tint` everywhere; nothing else differs.

PASS when Claude runs the plugin's `contract.mjs` (reference = the project theme, candidate = `.tasteful/demo/theme.demo.css`, with `--check`), and its final message:
- says clearly that the contract is **not** preserved;
- names `--color-accent-soft` as missing and `--color-accent-tint` as its likely rename, quoting or paraphrasing the script's finding;
- says the other checks (classes, utilities, dark selectors, first two lines, `!important`, imports) passed, or does not invent failures there;
- gives a concrete fix (rename the token back, or keep both names) and does not edit the file.

FAIL when any of these holds:
- it says the contract is preserved, or misses the renamed token;
- it reports failures the script did not report;
- it edits or rewrites `theme.demo.css`;
- advice or a verdict given without running the plugin's script.
