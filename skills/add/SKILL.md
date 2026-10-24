---
name: add
description: Add one reference website to the curated tasteful index by probing it live, drafting a fully tagged entry (typography, palette, layout, motion, what to extract, open font alternatives), showing it and writing it only after confirmation; includes an assisted Behance mode that reads projects you open in Chrome. Use when the user says "add this site to the index", "save this as a reference", "I found a nice site on Behance", or runs /tasteful:add. Don't use it to crawl award sites in bulk (use refresh), to record a like or dislike of an indexed site (use rate), or to find references for a brief (use find).
argument-hint: "<url> [source-url] [--anchor] | behance [project-url]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(bash *), AskUserQuestion, ToolSearch, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__get_page_text, mcp__claude-in-chrome__find
---

# Add a site to the index

Probe a site, draft a complete `sites.json` entry from real facts and screenshots, and write it only after the user confirms. Talk in the user's language; the entry is in English.

Arguments: `$ARGUMENTS` (`$0` = url or `behance`, `$1` = optional source url, `--anchor` anywhere marks an anchor entry).

## Flow

1. **Parse.** If `$0` is `behance`, or a `behance.net` url with no live-site link in the arguments, go to **Assisted Behance mode**. Otherwise canonicalise `$0` (https, no tracking params, no `#…`, no trailing slash except the root). `$1`, if given, is `source_url`.
2. **Already known?** Write `{"url":"<url>"}` as one line to `${CLAUDE_PLUGIN_DATA}/tmp/add-candidate.jsonl` and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" diff --candidates "${CLAUDE_PLUGIN_DATA}/tmp/add-candidate.jsonl" --data "${CLAUDE_PLUGIN_DATA}"`. Empty output means it is in `sites.json` or `rejected.json`: Grep both, tell the user which (with the reject reason if any), and offer to update the existing entry instead. Stop unless they choose to update.
3. **Deps.** `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}" --browsers --json`.
4. **Probe.** Choose the id (kebab-case from the site name, unique in `sites.json`). Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" <url> --deep --out "${CLAUDE_PLUGIN_ROOT}/index/shots/<id>" --json --data "${CLAUDE_PLUGIN_DATA}"` and save stdout to `${CLAUDE_PLUGIN_ROOT}/index/probes/<id>.json`. Exit 1 → the site is dead: report status and errors, offer to record it in `rejected.json`, stop. Exit 2 (no Playwright) → re-run without `--deep`, note "no screenshots, static facts".
5. **Look.** Read the desktop and mobile screenshots. Combine them with probe facts to tag the entry; never tag from the screenshot alone when a probe fact exists.
6. **Fonts.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/fonts.mjs" "<face>" … --json --data "${CLAUDE_PLUGIN_DATA}"` for the observed faces → `typography.open_alternatives` (prefer variable, note Cyrillic).
7. **Draft the entry** (rules below) and judge it against `${CLAUDE_PLUGIN_ROOT}/index/taste.md` and the drop rules in `${CLAUDE_PLUGIN_ROOT}/docs/INDEX-SCHEMA.md` (template demo, template seller, pure WebGL showpiece → reject).
8. **Show and confirm.** Print the entry as a JSON block plus a two-line verdict (fits the taste profile? anything tentative?). AskUserQuestion: "Add it" / "Add as tentative" / "Edit fields first" / "Reject (record reason)" / "Cancel". Write nothing before the answer.
9. **Write.** Save the entry to `${CLAUDE_PLUGIN_DATA}/tmp/entry-<id>.json`, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" upsert --entry "${CLAUDE_PLUGIN_DATA}/tmp/entry-<id>.json" --json --data "${CLAUDE_PLUGIN_DATA}"`. For "Reject": `index-edit.mjs reject --url <url> --reason "<one line>"`. Exit 1 → show the schema errors, fix, ask again.
10. **Verify.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-index.mjs" --data "${CLAUDE_PLUGIN_DATA}"`. Report the result and the new entry id.

## Entry rules

- Every field of `docs/INDEX-SCHEMA.md` is filled: `id, url, title, source, source_url, source_score, added, status, last_checked, kind, mood, typography{display, body, faces, open_alternatives, note}, color{strategy, dominant, accent, ink, note}, layout{grid, density, hero, note}, motion, extractable, why, avoid`, plus `screenshots` when written and `probe` pointing at `index/probes/<id>.json`.
- `source` from the source url host: `awwwards.com` → `awwwards`, `cssdesignawards.com` → `cssda`, `behance.net` → `behance`, otherwise `manual` (and `source_url` = the url itself when none is given). `source_score` only when the source shows one, else `null`.
- `status: "live"`, `added` and `last_checked` = today. `anchor: true` only with `--anchor`. `tentative: true` when unsure it passes the taste profile.
- `faces` are families from computed styles; `dominant`/`accent`/`ink` come from `colors` by area and weight; `motion` from `motion.level_guess`, corrected by what the screenshots and transitions show.
- `why` is one or two concrete sentences; `avoid` names what not to copy. No filler.

## Assisted Behance mode

Behance answers plain fetches with 403 and its `robots.txt` disallows Claude user agents, so the plugin does not crawl it; instead the user browses and you read only the pages they open. Say that in one line.

1. Load the browser tools in one call: ToolSearch `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__find`.
2. **If they load:** `tabs_context_mcp`, then `tabs_create_mcp` and `navigate` to `https://www.behance.net/` (or to `$1` if a project url was given). Ask the user to open a project they like and answer "next" (AskUserQuestion: "Next — a project is open" / "Done").
3. For each "next": read the active tab's url and the project page (`get_page_text`, `find` "website", "visit", "live site"). Take the external website link from the project's credits, description or links; ignore Behance, Adobe and social links. No external site → say so and wait for the next project.
4. Run the normal Flow from step 2 with `url` = the external site and `source_url` = the project page, `source: "behance"`. Confirm each entry separately.
5. **If the browser tools are unavailable**, ask the user to paste Behance project urls (and the live site link if they see it); read nothing from Behance yourself, then proceed as in step 4 for each live site they give.

## Index edits

This edits the plugin's own `index/` files. With a marketplace install they live in the plugin cache and are replaced on update; for a personal index, run from a checkout (`claude --plugin-dir <path>`) or a fork. Say so the first time you write.

## Scripts

| Command | Does | Exit codes |
| --- | --- | --- |
| `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}" --browsers --json` | Deps + Chromium into the data dir | 0 ready (check `fallback`) · 1 npm ci failed · 2 usage/env |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" diff --candidates <jsonl> --data "${CLAUDE_PLUGIN_DATA}"` | Prints the url back only if it is in neither index nor rejected list | 0 done · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" <url> --deep --out <dir> --json --data "${CLAUDE_PLUGIN_DATA}"` | Design facts + screenshots | 0 probed · 1 dead · 2 usage / no Playwright |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/fonts.mjs" <family...> --json --data "${CLAUDE_PLUGIN_DATA}"` | Open `@fontsource` alternatives | 0 mapped · 1 unmapped · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" upsert --entry <file> --json --data "${CLAUDE_PLUGIN_DATA}"` | Schema-checked insert/replace by id | 0 written · 1 invalid, nothing written · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" reject --url <url> --reason <text> --data "${CLAUDE_PLUGIN_DATA}"` | Appends to `rejected.json` | 0 done · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-index.mjs" --data "${CLAUDE_PLUGIN_DATA}"` | Schema, duplicates, dead, rejected overlap | 0 valid · 1 violation · 2 unreadable |

## Completion checklist

- [ ] Duplicate / rejected check ran before probing
- [ ] The site was probed live; probe JSON saved under `index/probes/<id>.json`
- [ ] Screenshots read (or "static facts, no screenshots" stated)
- [ ] Every schema field filled from probe facts, with `open_alternatives` from `fonts.mjs`
- [ ] The entry was shown and the user confirmed before any write
- [ ] `upsert` (or `reject`) exited 0 and `validate-index.mjs` was run
- [ ] Behance mode read only pages the user opened or pasted
