---
name: rate
description: Record taste feedback on a reference site in the tasteful index — a plus or minus with an optional note — in the feedback log of taste.md, optionally set what to avoid or remove the site, and turn three consistent signals into a proposed Likes or Dislikes rule. Use when the user says "I like this reference", "this one is not for me", "never show me sites like this", or runs /tasteful:rate. Don't use it to add a new site (use add), to mark dead sites (use check), or to get references for a brief (use find).
argument-hint: "<id|url> +|- [note]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(bash *), AskUserQuestion
---

# Rate a reference

Log one piece of taste feedback, act on a negative note only with the user's choice, and promote repeated signals into rules only after confirmation. Talk in the user's language; log lines and rules are in English.

Arguments: `$ARGUMENTS` (`$0` = id or url, `$1` = `+` or `-`, the rest = note).

## Flow

1. **Parse.** `$1` must be `+` or `-` (accept `−`, "like"/"dislike" as synonyms). If it is missing, ask with AskUserQuestion ("+ like" / "− dislike").
2. **Resolve the entry** in `${CLAUDE_PLUGIN_ROOT}/index/sites.json`: by `id`, else by canonical `url` (ignore protocol, `www.`, trailing slash, tracking params). Not found → say so, offer `/tasteful:add <url>`, stop. Several matches → ask which.
3. **Log it.** Edit `${CLAUDE_PLUGIN_ROOT}/index/taste.md`: append to the end of `## Feedback log` exactly one line `- YYYY-MM-DD · <id> · + · <note>` (or `· − ·`; empty note → omit the last ` · <note>`). Remove the `- (no feedback yet)` placeholder on the first entry. Touch nothing else in the file.
4. **Minus with a note.** Ask with AskUserQuestion: "Set `avoid` to this note" / "Remove it from the index" / "Log only".
   - Set avoid: write the entry with `avoid` set (append to an existing `avoid` with "; ") to `${CLAUDE_PLUGIN_DATA}/tmp/entry-<id>.json`, then `index-edit.mjs upsert --entry <file> --json`.
   - Remove: `index-edit.mjs reject --url <url> --reason "<note>"` (it also drops the entry from the index).
   - Then `validate-index.mjs`.
5. **Look for a pattern.** Read every log line, join each id with its entry (mood, typography.display, color.strategy, layout.hero, layout.density, motion, recurring words in notes). A pattern is **three or more signals of the same sign** sharing one attribute value or one note theme, with no opposite signal on the same value and no existing rule that already says it.
6. **Propose, do not write.** For a pattern, show the evidence (the log lines) and one rule in a designer's voice for Likes (`+`) or Dislikes (`−`), e.g. "Hero videos that autoplay behind text." Optionally a weight change in `## Weights` (e.g. add the value to `taste.avoid`). AskUserQuestion: "Add the rule" / "Add the rule and the weight" / "Edit wording" / "Not now".
7. **Apply only on confirmation.** Edit taste.md. If the Weights fence changed, verify it still parses: `node "${CLAUDE_PLUGIN_ROOT}/scripts/rank.mjs" --brief "${CLAUDE_PLUGIN_ROOT}/fixtures/briefs/ai-architect-blog.json" --n 3 --data "${CLAUDE_PLUGIN_DATA}"` must not exit 2; if it does, revert your edit and report.
8. Report: the log line, any index change, any rule added or pending.

## Log format

```
- 2026-10-24 · quiet-type-studio · + · serif display carries the page, one accent
- 2026-10-24 · loud-agency · − · autoplay video hero behind text
```

One line per rating, newest last, no edits to earlier lines.

## Index edits

This edits the plugin's own `index/taste.md` and `index/sites.json`. With a marketplace install they live in the plugin cache and are replaced on update; for a personal profile, run from a checkout (`claude --plugin-dir <path>`) or a fork. Say so the first time.

## Scripts

| Command | Does | Exit codes |
| --- | --- | --- |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" upsert --entry <file> --json --data "${CLAUDE_PLUGIN_DATA}"` | Writes the entry with the new `avoid` | 0 written · 1 invalid, nothing written · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/index-edit.mjs" reject --url <url> --reason <text> --data "${CLAUDE_PLUGIN_DATA}"` | Removes from the index, records in `rejected.json` | 0 done · 2 usage |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-index.mjs" --data "${CLAUDE_PLUGIN_DATA}"` | Validates the index after a change | 0 valid · 1 violation · 2 unreadable |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/rank.mjs" --brief <brief.json> --n 3 --data "${CLAUDE_PLUGIN_DATA}"` | Smoke test that the Weights fence still parses | 0/1 parsed · 2 fence missing or invalid |

## Completion checklist

- [ ] The entry was resolved from `sites.json` (or the user was sent to add)
- [ ] Exactly one line appended to `## Feedback log` in the documented format
- [ ] For `−` with a note, the user chose avoid / remove / log only, and only that was done
- [ ] `validate-index.mjs` ran after any index change
- [ ] Patterns of three consistent signals were proposed, never written without confirmation
- [ ] The Weights fence still parses if it was edited
