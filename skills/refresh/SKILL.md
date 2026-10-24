---
name: refresh
description: Refresh the curated tasteful index from its sources by crawling Awwwards, CSS Design Awards or Behance listings politely, dropping anything already indexed or rejected, probing the new candidates and presenting them in batches of ten with a keep or reject verdict, applying only what the user confirms. Use when the user says "look for new reference sites", "refresh the index", "what's new on Awwwards", or runs /tasteful:refresh. Don't use it for a single site (use add), for liveness of existing entries (use check), or to rank references for a brief (use find).
argument-hint: "[awwwards | cssda | behance | all] (default awwwards + cssda)"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(bash *), AskUserQuestion
---

# Refresh the index from its sources

Crawl, diff, probe and review new candidates with the user. Nothing enters the index or the rejected list without an explicit confirmation. Talk in the user's language.

Source: `$ARGUMENTS` (empty = `awwwards` and `cssda`; `behance` only when named, since it is best effort).

## Flow

1. **Plan the crawl.** Read `${CLAUDE_PLUGIN_ROOT}/index/sources.json` for the chosen sources and their collections. Default is **one listing page per collection** (`--pages 1`). Tell the user the plan: sources, collections, pages, and the rough request count (collections × pages, plus one award page per candidate for scores, at 1 request per second). If they want more than one page per collection, confirm with AskUserQuestion first (politeness and time).
2. **Deps.** `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}" --browsers --json`. Behance requires Playwright: if `fallback` is `"static"`, skip Behance and say why.
3. **Crawl** each source to its own temp file under `T = ${CLAUDE_PLUGIN_DATA}/tmp/refresh-<YYYY-MM-DD>` (create it first by writing the plan to `T/plan.md` with Write):
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/crawl-awwwards.mjs" --pages 1 --limit 60 --data "${CLAUDE_PLUGIN_DATA}" > "T/awwwards.jsonl"`
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/crawl-cssda.mjs" --pages 1 --limit 60 --data "${CLAUDE_PLUGIN_DATA}" > "T/cssda.jsonl"`
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/crawl-behance.mjs" --limit 20 --max-minutes 15 --data "${CLAUDE_PLUGIN_DATA}" > "T/behance.jsonl"`

   Exit 1 = zero candidates (blocked or the layout changed): report the stderr summary and continue with the other sources.
4. **Diff** each source file: `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" diff --candidates "T/<source>.jsonl" --data "${CLAUDE_PLUGIN_DATA}" > "T/new-<source>.jsonl"`, then combine the `new-*.jsonl` files into `T/new.jsonl` (Read + Write, dropping duplicate urls). Report: crawled n, already indexed or rejected m, new k. If k = 0, stop.
5. **Liveness.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" --batch "T/new.jsonl" --quick --concurrency 3 --data "${CLAUDE_PLUGIN_DATA}" > "T/quick.jsonl"` (exit 1 just means some are dead). Survivors = status < 400. Dead ones are dropped from review (not rejected: they may come back).
6. **Review in batches of 10**, in source-score order. For each survivor in the batch, deep-probe: `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" <url> --deep --out "${CLAUDE_PLUGIN_ROOT}/index/shots/<id>" --json --data "${CLAUDE_PLUGIN_DATA}" > "T/probe-<id>.json"` (`index/shots/` is gitignored), read the screenshots, and draft a full entry as `/tasteful:add` does (same entry rules, `fonts.mjs` for open alternatives, `source`, `source_url`, `source_score` from the candidate line).
7. **Verdicts.** Present the batch as a table: `# | title | url | award · score | verdict | reason` where verdict is **keep** (fits `taste.md`, reusable system) or **reject** (template demo, template seller, pure WebGL showpiece with no reusable system, conflicts with Dislikes, broken on mobile) with a one-line reason. Mark borderline keeps "keep (tentative)".
8. **Confirm.** AskUserQuestion: "Apply all verdicts" / "Choose which to keep" (then a multi-select of the batch) / "Skip this batch" / "Stop". Apply **only** what was confirmed:
   - keep → write the entry to `${CLAUDE_PLUGIN_DATA}/tmp/entry-<id>.json`, `index-edit.mjs upsert --entry <file>`, then copy `T/probe-<id>.json` to `${CLAUDE_PLUGIN_ROOT}/index/probes/<id>.json` (Read + Write);
   - reject → `index-edit.mjs reject --url <url> --reason "<reason>"`;
   - unconfirmed → nothing (they reappear next refresh).
9. Next batch until done or the user stops. Then `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-index.mjs" --data "${CLAUDE_PLUGIN_DATA}"` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" stats --data "${CLAUDE_PLUGIN_DATA}"`, and report added, rejected, skipped.

## Politeness

Crawlers already run at 1 request per second with a real User-Agent and skip `robots.txt` disallows; do not work around them, do not run sources in parallel, and never raise `--pages` without the user's confirmation. Behance stays best effort (home feed only); if it yields nothing, point to `/tasteful:add behance`.

## Index edits

This edits the plugin's own `index/` files. With a marketplace install they live in the plugin cache and are replaced on update; for a personal index, run from a checkout (`claude --plugin-dir <path>`) or a fork.

## Scripts

| Command | Does | Exit codes |
| --- | --- | --- |
| `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}" --browsers --json` | Deps + Chromium | 0 ready (check `fallback`) · 1 npm ci failed · 2 usage/env |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/crawl-awwwards.mjs" --pages <n> --limit <n> --data "${CLAUDE_PLUGIN_DATA}"` | Candidate JSONL from award collections | 0 candidates · 1 zero · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/crawl-cssda.mjs" --pages <n> --limit <n> --data "${CLAUDE_PLUGIN_DATA}"` | Candidate JSONL from CSSDA | 0 candidates · 1 zero · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/crawl-behance.mjs" --limit <n> --max-minutes 15 --data "${CLAUDE_PLUGIN_DATA}"` | Best-effort home-feed candidates | 0 candidates · 1 zero kept · 2 usage / no Playwright |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" diff --candidates <jsonl> --data "${CLAUDE_PLUGIN_DATA}"` | Candidates in neither index nor rejected list (JSONL) | 0 done · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" --batch <jsonl> --quick --concurrency 3 --data "${CLAUDE_PLUGIN_DATA}"` | Liveness per candidate (JSONL) | 0 all live · 1 any dead · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" <url> --deep --out <dir> --json --data "${CLAUDE_PLUGIN_DATA}"` | Design facts + screenshots | 0 probed · 1 dead · 2 usage / no Playwright |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/fonts.mjs" <family...> --json --data "${CLAUDE_PLUGIN_DATA}"` | Open font alternatives | 0 mapped · 1 unmapped · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" upsert --entry <file> --json --data "${CLAUDE_PLUGIN_DATA}"` | Schema-checked write | 0 written · 1 invalid · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" reject --url <url> --reason <text> --data "${CLAUDE_PLUGIN_DATA}"` | Records a rejection | 0 done · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-index.mjs" --data "${CLAUDE_PLUGIN_DATA}"` | Validates the index | 0 valid · 1 violation · 2 unreadable |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" stats --data "${CLAUDE_PLUGIN_DATA}"` | Counts per source, kind, mood, status | 0 done |

## Completion checklist

- [ ] The crawl plan was stated; more than one page per collection only after confirmation
- [ ] Crawler output went to temp JSONL and was diffed against index + rejected list
- [ ] New candidates were quick-probed, survivors deep-probed per batch
- [ ] Batches of at most 10, each with a keep/reject verdict and one-line reason
- [ ] Only confirmed items were upserted or rejected; nothing was added silently
- [ ] `validate-index.mjs` ran at the end and stats were reported
