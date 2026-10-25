---
name: find
description: Find 3–5 design reference sites for a new website brief from the curated tasteful index, ranked by the taste profile, each with a link, why it fits, what to take and what to leave, plus 2–3 suggested combinations written to a proposal. Use when the user says "find design references for…", "what sites should I look at for…", "give me inspiration for a site that…", or runs /tasteful:find. Don't use it to generate the theme (use extract after approval), to add a site to the index (use add), or to crawl for new candidates (use refresh).
argument-hint: "<free-text brief: kind, audience, tone, density, motion 0-3, dark mode, must-haves>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(bash *), AskUserQuestion
---

# Find design references for a brief

Turn a short brief into a ranked, verified shortlist of reference sites from the curated index, and write it as a proposal the user can approve. Nothing is extracted here. Talk to the user in the language of the brief; keep file contents and JSON keys in English (proposal prose may follow the brief's language).

Brief: `$ARGUMENTS`

## Flow

1. **Read the brief.** If `$ARGUMENTS` is empty, ask for a brief with AskUserQuestion and stop until it arrives. Map it onto the vocabulary of `${CLAUDE_PLUGIN_ROOT}/docs/INDEX-SCHEMA.md` (`kind`, `mood`) and the brief fields in the table below.
2. **Fill gaps with one question.** If any required field is missing or ambiguous, ask **once**, with a single AskUserQuestion call whose first option is "Use these defaults (recommended)" and lists the defaults you would apply. Never ask a second round; proceed with defaults for anything still unanswered. **Site scope:** Glob `apps/*/` in the project. When app folders exist and the brief names one of them, or says "only for <site>", "site layer" or "overlay", include in that same call a question with the options "Site layer for `<site>`" and "Shared theme (default)". Without app folders or such wording, do not ask; the look is for the shared theme.
3. **Write the brief.** Pick a kebab-case slug (3–5 words, ASCII, from the title). Write `${user_config.output_dir}/<slug>/brief.json` in the shape of `docs/SCRIPTS.md` → Brief JSON (`${CLAUDE_PLUGIN_ROOT}/fixtures/briefs/*.json` are examples). Write `site` only when a site layer was chosen; leave it out for the shared theme. If the folder already holds a proposal, ask whether to overwrite or use a new slug.
4. **Ensure deps** (no browsers needed): `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}" --json`. If it fails, continue: `rank.mjs` and `probe.mjs --quick` are dependency-free.
5. **Rank.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/rank.mjs" --brief "${user_config.output_dir}/<slug>/brief.json" --n ${user_config.max_candidates} --data "${CLAUDE_PLUGIN_DATA}"`. Exit 1 (fewer than 3 eligible) → tell the user which filters bit (from `excluded`) and offer to relax motion or dark-mode constraints; exit 2 → report the error and stop.
6. **Look up each candidate** in `${CLAUDE_PLUGIN_ROOT}/index/sites.json` (title, url, source_url, extractable, why, avoid, typography, color, layout, motion, anchor).
7. **Verify liveness.** Write the candidate urls one per line to `${user_config.output_dir}/<slug>/candidates.txt` and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" --batch "${user_config.output_dir}/<slug>/candidates.txt" --quick --json --data "${CLAUDE_PLUGIN_DATA}"`. For each dead result (status ≥ 400 or a network error while others succeeded): `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" set-status --id <id> --status dead --data "${CLAUDE_PLUGIN_DATA}"`, then re-run step 5 (dead entries drop out) and re-verify only the newcomers. At most three rounds. Replace silently in the proposal, but list replacements in one line at the end of your message.
8. **Offline guard.** If *every* probe fails with a network error and no HTTP status, assume the machine is offline: do not change any status, mark the proposal "liveness not verified", and say so.
9. **Write the proposal**: `proposal.md` and `proposal.json` in `${user_config.output_dir}/<slug>/` (shapes below).
10. **Present** the proposal in the chat (same content as `proposal.md`, compact) and end with exactly this sentence:

    Reply with your choice, e.g. `approve B` or `approve 1, palette from 3`, then run `/tasteful:extract <brief-slug>`.

    with `<brief-slug>` replaced by the real slug.

## Brief fields and defaults

| Field | Values | Default when missing |
| --- | --- | --- |
| kind | `sites.json` kind vocabulary | inferred from the brief; ask if unclear |
| audience | one line | "general visitors" |
| tone | 3 adjectives | from the brief's wording |
| density | `text-heavy` · `balanced` · `visual` | `balanced` |
| motion | 0–3 | 1 |
| dark_mode | `both` · `light-first` · `dark-first` | `both` |
| must_have | extractables / components | `[]` |
| mood | `sites.json` mood vocabulary | derived from tone |
| languages | BCP-47 codes | `["en"]`; if the user's sites are trilingual (EN/RU/ES), `["en","ru","es"]` |
| site | name of the app folder under `apps/` when the look is for one site only | absent = shared theme; extract then also derives a site layer |

## Writing each candidate

Use `rank.mjs` output as the backbone (`reasons`, `take`, `leave`) and the index entry for facts. Every candidate, including a weaker one you label as such, gets all four parts below; never collapse a candidate to take/leave only. For each candidate, numbered 1…n:

- **Title** — url — source link (`source_url`), and "anchor" if `anchor: true`.
- **Why it fits this brief** — one paragraph tied to the brief's words (audience, tone, density, motion), citing concrete index facts (faces, strategy, density, hero). No generic praise.
- **What to take** — bullets from `extractable`, filtered by relevance to the brief and `must_have`, each with the concrete fact (e.g. "type pairing — Fraunces display over Inter body, 1.6 body line-height").
- **What to leave** — one line, from `leave` / `avoid` (e.g. "the full-bleed video hero; over the motion budget").

Then **2–3 combinations** from `combinations` (add one only if rank gave fewer than two): label A/B/C, the parts ("typography of #2 + palette of #1 + cards of #3"), and one sentence on the resulting character. Keep one combination a single reference ("A: #1 alone").

## Output shapes

`proposal.md`: `# <title>` · brief summary (fields table) · numbered candidates as above · `## Combinations` · `## Next step` with the approval sentence. Add "liveness not verified" under the title when step 8 applied.

`proposal.json`:

```jsonc
{
  "slug": "…", "created": "YYYY-MM-DD", "brief": "brief.json",
  "verified": true,                       // false when offline
  "candidates": [{ "n": 1, "id": "…", "url": "…", "title": "…", "source_url": "…", "anchor": false,
                   "score": 0, "why": "…", "take": ["type-pairing"], "leave": "…" }],
  "combinations": [{ "label": "A", "parts": [{ "n": 1, "id": "…", "take": ["all"] }], "character": "…" }],
  "replaced": [{ "id": "…", "reason": "dead (status 404)" }]
}
```

## Index edits

Marking a dead site edits the plugin's own `index/sites.json`. With a marketplace install that file lives in the plugin cache and is replaced on update; for a personal index, run the plugin from a checkout (`claude --plugin-dir <path>`) or a fork. Mention this once when you change a status.

## Scripts

Run each command as its own Bash call with literal paths: no `;`, `&&`, `|`, `echo $?`, shell variables or `$(…)`. The `Bash(node *)` and `Bash(bash *)` allow rules match a single command only, so compound commands are refused in headless and auto modes and cost a turn. A plain `> file` redirect to a literal path is fine.

| Command | Does | Exit codes |
| --- | --- | --- |
| `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}" --json` | Installs npm deps into the data dir once | 0 ready · 1 npm ci failed · 2 usage/env |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/rank.mjs" --brief <brief.json> --n ${user_config.max_candidates} --data "${CLAUDE_PLUGIN_DATA}"` | Scores live entries, returns diverse candidates + combinations (JSON) | 0 ranked · 1 fewer than 3 eligible · 2 unreadable input |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" --batch <file> --quick --json --data "${CLAUDE_PLUGIN_DATA}"` | Fetch-only liveness per url (JSONL) | 0 all live · 1 any dead · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" set-status --id <id> --status dead --data "${CLAUDE_PLUGIN_DATA}"` | Marks an entry dead, sets `last_checked` | 0 done · 1 id not found · 2 usage |

## Completion checklist

- [ ] At most one clarifying question was asked, with defaults offered
- [ ] `brief.json` exists and matches the Brief JSON shape; `site` is set only for a chosen site layer
- [ ] `rank.mjs` was run with `--n ${user_config.max_candidates}`; no candidate was hand-picked outside its output
- [ ] Every presented candidate was quick-probed; dead ones were marked and replaced (or the offline guard was stated)
- [ ] Each candidate has url, source link, why, what to take, what to leave
- [ ] 2–3 combinations, one of them a single reference
- [ ] `proposal.md` and `proposal.json` written under `${user_config.output_dir}/<slug>/`
- [ ] The message ends with the approval sentence and the real slug; nothing was extracted
