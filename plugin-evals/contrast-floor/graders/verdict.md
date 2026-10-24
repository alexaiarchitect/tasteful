---
type: llm
focus: trace
---

**What the judge can see:** the full trace — the prompt, every tool call and its output (including the `contrast.mjs` table), and Claude's final message. The theme is the reference theme with the light-scheme `--color-muted` changed from `#5c6370` to `#9aa0a8`, which gives about 2.44:1 on `--color-bg` `#f6f6f4` (minimum 4.5:1). Every other required pair passes in both schemes.

PASS when Claude runs the plugin's `contrast.mjs` on the file, and its final message:
- says the theme does **not** meet the floor;
- identifies the single failure: light scheme, `--color-muted` on `--color-bg`, with the computed ratio (≈ 2.44:1) and the 4.5:1 minimum;
- states that the dark scheme passes (no invented dark failures);
- proposes a concrete fix, preferably the script's suggested colour (e.g. `#6c7179` or another value it reports as passing), and does not edit the file.

FAIL when any of these holds:
- it says the theme passes, or reports a ratio that contradicts the script output;
- it names the wrong pair or the wrong scheme;
- it estimates contrast by eye instead of using the script's numbers;
- it edits `theme.low-contrast.css`;
- advice or a verdict given without running the plugin's script.
