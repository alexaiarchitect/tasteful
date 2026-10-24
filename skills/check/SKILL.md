---
name: check
description: Check the health of the curated tasteful index by re-probing every reference site, reporting dead, redirected and retitled sites, updating status and last_checked after confirmation, and with --screenshots refreshing the screenshots of sites whose title or fonts changed. Use when the user asks "are the references still live?", "check the index", "which sites are dead?", or runs /tasteful:check. Don't use it to look for new sites (use refresh), to add one site (use add), or to verify a generated theme (use extract verify).
argument-hint: "[--screenshots]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(bash *), AskUserQuestion
---

# Check the index

Re-probe every entry, report what changed, and update statuses only after the user confirms. Talk in the user's language.

Arguments: `$ARGUMENTS` (`--screenshots` also refreshes screenshots of changed sites).

## Flow

1. **Deps.** `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}" --json` (add `--browsers` with `--screenshots`).
2. **List urls.** Let `T = ${CLAUDE_PLUGIN_DATA}/tmp/check-<YYYY-MM-DD>`. Read `${CLAUDE_PLUGIN_ROOT}/index/sites.json` and Write `T/urls.jsonl` with one `{"id","url","title"}` object per entry (every status, so dead sites can come back).
3. **Probe.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" --batch "T/urls.jsonl" --quick --concurrency 3 --data "${CLAUDE_PLUGIN_DATA}" > "T/quick.jsonl"`. Exit 1 only means some are dead. Join results back to entries by `url`.
4. **Offline guard.** If every result is a network error with no HTTP status, the machine is offline: change nothing, say so, stop.
5. **Report** a table of changes only: `id | was | now | evidence` with
   - **dead**: status ≥ 400 or a network error (show status / first error);
   - **back**: was `dead`, now answers < 400;
   - **redirected**: `final_url` on another host (suggest updating `url`);
   - **retitled**: `title` differs meaningfully from the entry's title (may signal a redesign).

   Plus a summary line: n checked, live, dead, redirected, retitled, elapsed.
6. **Confirm.** AskUserQuestion: "Apply statuses (mark dead / live, set last_checked)" / "Apply and move dead ones to rejected" / "Report only". Then:
   - every probed entry: `index-edit.mjs set-status --id <id> --status live|dead` (this also sets `last_checked`);
   - "move to rejected": `index-edit.mjs reject --url <url> --reason "dead since YYYY-MM-DD (status <n>)"`;
   - redirects: never rewrite `url` here; suggest `/tasteful:add <new-url>` or an edit.
7. **Screenshots** (only with `--screenshots`). Candidates = retitled entries plus entries whose fonts changed. To detect font changes, Write the live entries to `T/live.jsonl` and run the default browser probe `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" --batch "T/live.jsonl" --concurrency 3 --data "${CLAUDE_PLUGIN_DATA}" > "T/facts.jsonl"`; compare `fonts.faces` with `typography.faces`. Tell the user how many sites will be re-shot, confirm, then per site `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" <url> --deep --out "${CLAUDE_PLUGIN_ROOT}/index/shots/<id>" --json --data "${CLAUDE_PLUGIN_DATA}" > "${CLAUDE_PLUGIN_ROOT}/index/probes/<id>.json"`. Report changed faces; suggest `/tasteful:add <url>` to re-tag a redesigned site rather than editing tags silently.
8. **Verify.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-index.mjs" --data "${CLAUDE_PLUGIN_DATA}"`. Dead entries count as violations by design; say that if they are the only ones.

## Index edits

This edits the plugin's own `index/` files. With a marketplace install they live in the plugin cache and are replaced on update; for a personal index, run from a checkout (`claude --plugin-dir <path>`) or a fork.

## Scripts

| Command | Does | Exit codes |
| --- | --- | --- |
| `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PLUGIN_DATA}" [--browsers] --json` | Deps (and Chromium for screenshots) | 0 ready · 1 npm ci failed · 2 usage/env |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" --batch <jsonl> --quick --concurrency 3 --data "${CLAUDE_PLUGIN_DATA}"` | Liveness, final url, title per entry (JSONL) | 0 all live · 1 any dead · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" --batch <jsonl> --concurrency 3 --data "${CLAUDE_PLUGIN_DATA}"` | Computed fonts per entry, for change detection | 0 · 1 any dead · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs" <url> --deep --out <dir> --json --data "${CLAUDE_PLUGIN_DATA}"` | Fresh screenshots + facts | 0 probed · 1 dead · 2 usage / no Playwright |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" set-status --id <id> --status live\|dead --data "${CLAUDE_PLUGIN_DATA}"` | Status + `last_checked` | 0 done · 1 id not found · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" reject --url <url> --reason <text> --data "${CLAUDE_PLUGIN_DATA}"` | Moves a dead site to `rejected.json` | 0 done · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-index.mjs" --data "${CLAUDE_PLUGIN_DATA}"` | Validates the index | 0 valid · 1 violation · 2 unreadable |

## Completion checklist

- [ ] Every entry was quick-probed in one batch run
- [ ] The offline guard was applied before any status change
- [ ] Dead, back, redirected and retitled sites were reported with evidence
- [ ] Statuses were written only after confirmation, via `set-status`
- [ ] With `--screenshots`, only changed sites were re-shot, after confirmation
- [ ] `validate-index.mjs` ran at the end
