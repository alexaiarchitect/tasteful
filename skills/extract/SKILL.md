---
name: extract
description: Turn an approved selection of design references into a drop-in replacement theme.css that keeps the framework's token and class contract, with fonts.json, REPORT.md, a preview and an independent critic review; also verifies an existing generated theme's contract and contrast. Use when the user approves a tasteful proposal ("approve B", "approve 1, palette from 3"), asks to "extract the theme" or "generate styles from these references", or asks whether a generated theme keeps the contract or meets the contrast floor. Don't use it before a proposal exists (use find) or to change the index (use add, rate, refresh).
argument-hint: "<brief-slug> [approval text, e.g. approve B] | verify <theme.css>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(bash *), AskUserQuestion, Agent
---

# Extract a theme from approved references

Compose the approved references into `theme.<slug>.css` plus fonts, report and preview, prove it passes the contract and contrast checks, get an independent critique, and hand over swap-in steps. Never modify the sites repo. Talk in the language of the user's brief; files are in English.

Arguments: `$ARGUMENTS` (slug = `$0`).

## Flow

1. **Mode.** If `$0` is `verify`, or the user only asks whether an existing theme passes, go to **Verify mode** below. Otherwise `$0` is the slug; `D = ${user_config.output_dir}/$0`. Read `D/proposal.json` and `D/brief.json`. If they are missing, say so and point to `/tasteful:find`; stop.
2. **Approval gate.** The approval is the argument text after the slug (e.g. `approve B`, `approve 1, palette from 3`). If there is none, ask with AskUserQuestion: one option per proposal combination (label + parts), plus "Not yet". If the user does not approve, **stop: write nothing, probe nothing.** Write the approval text **verbatim** to `D/approval.md`, followed by a `## Resolved` section mapping each facet to a reference id.
3. **Resolve facets.** Facets: typography, palette, cards, buttons, chips, hero, section-rhythm, spacing-scale, nav, footer, motion. "typography from X" means only typography facts come from X. A single reference supplies every facet. Unassigned facets come from the first reference named, or stay at the baseline (`/* derived */`). Ask only if the approval names a candidate number that does not exist.
4. **Contract.** Reference = `${user_config.theme_path}` (relative to the project root). If it does not exist, use `${CLAUDE_PLUGIN_ROOT}/fixtures/theme.reference.css` and warn the user that the contract comes from the fixture. Confirm it parses: `node "${CLAUDE_PLUGIN_ROOT}/scripts/contract.mjs" <reference> <reference> --json --data "${CLAUDE_PLUGIN_DATA}"`. Read it fully: its tokens, classes, dark selectors and `@utility` are the contract.
5. **Deps.** `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}" --browsers --json`. If `fallback` is `"static"`, deep probes and screenshots are unavailable: probe without `--deep`, use `preview.mjs --html-only`, and say so in REPORT.md.
6. **Probe each approved reference.** Reuse `${CLAUDE_PLUGIN_ROOT}/index/probes/<id>.json` when its `probed_at` is under 30 days old and its screenshots exist. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" <url> --deep --out "D/refs/<id>" --json --data "${CLAUDE_PLUGIN_DATA}"` redirecting stdout to `D/probe-<id>.json`. Exit 1 → the reference is dead: tell the user and offer the next proposal candidate for that facet. Read each reference's desktop and mobile screenshots.
7. **Fonts.** For the typography reference's observed faces: `node "${CLAUDE_PLUGIN_ROOT}/scripts/fonts.mjs" "<face>" … --verify --json --data "${CLAUDE_PLUGIN_DATA}"` (exit 2 = registry unreachable → re-run without `--verify` and note it). If the brief's `languages` include `ru` and a mapping has `cyrillic: false`, pick another open family with Cyrillic and say why. Prefer variable packages.
8. **Compose** `D/theme.$0.css` (rules below). Write `D/fonts.json`: `{ "packages": [{ "name", "family", "role", "observed", "variable", "cyrillic", "import" }], "imports": ["@import …;"] }`.
9. **Preview.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/preview.mjs" "D/theme.$0.css" --out "D" --json --data "${CLAUDE_PLUGIN_DATA}"` (`--html-only` in static fallback). Read both screenshots and compare them with the reference screenshots; fix obvious misses before checking.
10. **Checks, until both pass.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/contract.mjs" <reference> "D/theme.$0.css" --check --data "${CLAUDE_PLUGIN_DATA}"` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/contrast.mjs" "D/theme.$0.css" --suggest --data "${CLAUDE_PLUGIN_DATA}"`. On failure, apply the fix (for contrast, the suggested colour, keeping hue), note it in REPORT.md, re-run both. Never hand over a failing theme; after five rounds still failing, stop and report the remaining findings.
11. **Write `D/REPORT.md`** (sections below), including the final contrast table from `contrast.mjs --extended --json`.
12. **Critic.** Call the Agent tool with `subagent_type: "tasteful:critic"`. Give it only paths, not your reasoning: the theme, REPORT.md, fonts.json, preview-light/dark, the reference theme, `${CLAUDE_PLUGIN_ROOT}/index/taste.md`, `D/approval.md`, and each reference's probe JSON (`D/probe-<id>.json` or the cached `index/probes/<id>.json`) and screenshots.
13. **Apply findings.** Fix every blocking issue, then re-run step 10 (and step 9 if visuals changed). Apply nits that are cheap; list the rest under "Known gaps". If a blocker cannot be fixed, say so plainly.
14. **Hand over.** Summarise the result (files, references used per facet, contrast minimums, critic outcome) and print the swap-in steps from `${CLAUDE_PLUGIN_ROOT}/docs/SITES-INTEGRATION.md` with the real slug and packages. **Never perform the swap-in.**

## Composition rules

- Start from a copy of the reference theme and change values and component styles; never delete or rename a token, class, `@utility` or dark selector. New tokens are fine. Express each facet through the existing classes (`.card-link`, `.btn`, `.chip`, `.prose`, …): `preview.mjs` and the sites markup use only those, so a new class is invisible in the preview and the critic will block the facet as not visible. If a new class is unavoidable, list it under "Known gaps" as needing markup changes.
- First two statements stay `@import "tailwindcss";` and `@source "../";`, then the `@fontsource` imports from `fonts.json`. No external `@import`, no Google Fonts.
- Every token line ends with `/* from: <ref-id> — <what> */` (e.g. `/* from: acme-studio — h1 colour, 62% of text area */`) or `/* derived */`.
- Dark mode: override every `--color-*` and `--shadow-*` in `:root[data-theme="dark"]` and identically in `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`. For a dark-first reference, derive the light scheme and say so.
- Motion follows the brief's budget: 0 → colour transitions only, `.card-link` does not lift; 1 → short hover/fade with the reference easing; keep the `prefers-reduced-motion` block and its `!important` (the only one allowed).
- Long words: headings, `.btn`, `.chip` and cards keep `overflow-wrap: anywhere` or `hyphens: auto` where text can be Russian or Spanish.
- Roles stay: `.btn-primary` is the primary button, `.eyebrow` a small label above a heading, `.prose` styles long-form content.
- Avoid the template tells listed in `${CLAUDE_PLUGIN_ROOT}/agents/critic.md` unless a reference genuinely uses them and the approval asked for that facet.

## REPORT.md sections

1. Approval (quoted) and the facet → reference map.
2. Per facet: what was borrowed, probe evidence (observed value → chosen value), and why.
3. Derived: everything not observed (e.g. the light scheme of a dark-first site, soft/ink variants).
4. Fonts: observed face → open alternative, package, variable, Cyrillic.
5. Contrast table for both schemes (required and advisory pairs, ratios).
6. Deviations from `taste.md` and why.
7. Critic outcome: blockers fixed, nits applied, nits left.
8. Known gaps.

## Verify mode

`/tasteful:extract verify <theme.css>` (or a slug, meaning `${user_config.output_dir}/<slug>/theme.<slug>.css`). No approval is needed because nothing is extracted. Resolve the reference as in step 4, run the contract check and `contrast.mjs <theme.css> --extended --suggest`, and report every finding with the script's evidence: missing or renamed tokens and classes, failing pairs with ratio, minimum and scheme, suggested colours. Do not edit the file unless the user confirms a fix (AskUserQuestion: "Apply suggested fixes" / "Report only"); after a fix, re-run both checks.

## Scripts

Run each command as its own Bash call with literal paths: no `;`, `&&`, `|`, `echo $?`, shell variables or `$(…)`. The `Bash(node *)` and `Bash(bash *)` allow rules match a single command only, so compound commands are refused in headless and auto modes and cost a turn. A plain `> file` redirect to a literal path is fine.

| Command | Does | Exit codes |
| --- | --- | --- |
| `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}" --browsers --json` | Deps + Chromium into the data dir; reports static fallback | 0 ready (check `fallback`) · 1 npm ci failed · 2 usage/env |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/contract.mjs" <reference.css> <candidate.css> --check --data "${CLAUDE_PLUGIN_DATA}"` | Token/class/utility/dark-selector/first-lines/`!important`/external-import contract | 0 preserved · 1 finding · 2 unreadable |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/contrast.mjs" <theme.css> [--extended] [--suggest] --data "${CLAUDE_PLUGIN_DATA}"` | WCAG pairs in both schemes; nearest passing colours | 0 pass · 1 violation or dark mismatch · 2 unparseable/missing token |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" <url> --deep --out <dir> --json --data "${CLAUDE_PLUGIN_DATA}"` | Computed design facts + desktop/mobile screenshots | 0 probed · 1 dead · 2 usage / no Playwright for `--deep` |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/fonts.mjs" <family...> --verify --json --data "${CLAUDE_PLUGIN_DATA}"` | Observed face → `@fontsource` package, variable, Cyrillic | 0 mapped · 1 unmapped/unverified · 2 usage/registry unreachable |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/preview.mjs" <theme.css> --out <dir> [--html-only] --json --data "${CLAUDE_PLUGIN_DATA}"` | `preview.html` + `preview-light.jpg` / `preview-dark.jpg` | 0 written · 1 render failed · 2 usage / no Playwright |

## Completion checklist

- [ ] Approval obtained and stored verbatim in `approval.md` (or the run stopped with nothing written)
- [ ] Contract source stated (project theme or fixture, with warning)
- [ ] Every approved reference probed (or a fresh cached probe reused), screenshots read
- [ ] `theme.<slug>.css`, `fonts.json`, `REPORT.md`, `preview.html` and both preview screenshots exist in `${user_config.output_dir}/<slug>/`
- [ ] Every token carries a `from:` or `derived` comment
- [ ] Fonts are `@fontsource` packages with Cyrillic when the brief needs it
- [ ] `contract.mjs --check` and `contrast.mjs` both exit 0 on the final file
- [ ] The `tasteful:critic` agent reviewed it and every blocker was fixed (or reported as unfixable)
- [ ] Swap-in steps printed; the sites repo was not touched
