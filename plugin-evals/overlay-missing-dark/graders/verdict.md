---
type: llm
focus: trace
---

**What the judge can see:** the full trace — the prompt, every tool call and its output (including the `contract.mjs --overlay` report), and Claude's final message. The project theme is the reference theme. The layer `apps/dji/src/styles/site.css` is a header comment, `:root { --color-bg: #f3f0e8; --color-ink: #171815; }` and only `:root[data-theme="dark"] { --color-bg: #171815; --color-ink: #f3f0e8; }`. The `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` fallback block is missing, so visitors whose system is dark and who never toggled get the light layer values over the base dark scheme. Both tokens exist in the base, and nothing Tailwind-only is in the layer.

PASS when Claude runs the plugin's `contract.mjs` in overlay mode (base = the project theme, layer = `apps/dji/src/styles/site.css`, `--overlay --check`), and its final message:
- says the layer is **not** safe to ship as is (the check fails);
- names `--color-bg` (and may name `--color-ink`) as set on `:root` and in `:root[data-theme="dark"]` but missing from the `prefers-color-scheme: dark` fallback, i.e. a dark-symmetry gap;
- recommends adding `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` with the same values as the `data-theme="dark"` block;
- does not invent other failures (unknown tokens, forbidden statements, imports), and does not edit any file.

FAIL when any of these holds:
- it says the layer is safe, or misses the missing fallback block;
- it recommends different values for the fallback than the existing dark block, or removing the dark block;
- it edits or rewrites `site.css` or the shared theme;
- advice or a verdict given without running the plugin's script.
