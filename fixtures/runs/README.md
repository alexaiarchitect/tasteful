# Recorded end-to-end runs

The end-to-end acceptance from `docs/GOAL.md` §8 items 5–6, recorded on 2026-10-24 with Claude Code 2.1.310, `--model opus`, headless (`-p`).

## Folders

| Folder | Holds |
| --- | --- |
| `ai-architect-blog/` | Brief (a). `find` output (`brief.json`, `candidates.txt`, `proposal.md`, `proposal.json`, `find.transcript.md`) and `extract` output for `approve B` (`approval.md`, `theme.ai-architect-blog.css`, `fonts.json`, `REPORT.md`, `preview.html`, `preview-light.jpg`, `preview-dark.jpg`, `extract.transcript.md`). Also `cards-preview.html` and `cards-preview-*.jpg`: an extra render that `extract` made after the critic's first pass, to show the card facet. `probe-<id>.json` and `refs/<id>/{desktop,mobile}.jpg` are copies of the cached `index/probes/<id>.json` and `index/shots/<id>/` that `extract` reused. They were under 30 days old, so `extract` ran no new deep probe. They are copied here so the critic's inputs can be reproduced. |
| `piano-note-trainer/` | Brief (b): `find` output and transcript |
| `dji-settings-guide/` | Brief (c): `find` output and transcript |

Each `*.transcript.md` is rendered from the CLI's `stream-json` output. It shows every assistant message, every tool call (Bash commands in full), and every tool result clipped to 2,000 characters. The critic's reports are not clipped. The final `## Result` block gives turns, duration and cost. Paths in the transcripts point at the temporary stand-in project described below.

## Commands

The runs were made from a stand-in project directory (an empty folder with no `packages/theme/src/styles/theme.css`), with the plugin loaded from this checkout:

```sh
cd <empty project dir>
claude --plugin-dir ~/Documents/Business/alexaiarchitect/tasteful --model opus \
  -p "/tasteful:find $(cat fixtures/briefs/<slug>.md)
Slug: <slug>." \
  --permission-mode acceptEdits \
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash(node *),Bash(bash *),AskUserQuestion,Agent" \
  --max-turns 40 --output-format stream-json --verbose

claude --plugin-dir … --model opus -p "/tasteful:extract ai-architect-blog approve B" \
  … --max-turns 80 --output-format stream-json --verbose
```

Afterwards `.tasteful/<slug>/` was copied here. The briefs were complete, so no run asked a question. The `Slug:` line keeps the folder names equal to the fixture names.

## Results

| Run | Turns | Time | Cost | Outcome |
| --- | --- | --- | --- | --- |
| find ai-architect-blog | 16 | 84 s | $0.60 | aestudio, halfthesky, quakerschool, stash, farmminerals; combinations A/B/C |
| find piano-note-trainer | 16 | 101 s | $0.58 | aestudio, yigua, stash, almadalabel, estudioniksen; A/B/C |
| find dji-settings-guide | 17 | 103 s | $0.55 | stash, aestudio, yigua, enricbadrinas, almadalabel; A/B/C |
| extract ai-architect-blog `approve B` | 106 (critic turns included) | 623 s | $3.89 | contract ok, contrast ok, critic BLOCKED (1) then PASS |


Checks run by hand on the final theme: `contract.mjs … --check` exit 0; `contrast.mjs … --extended` exit 0 (lowest required pair: light muted/bg 5.19); all 65 `--` declarations (28 in `@theme`) carry `/* from: … */` or `/* derived */`; the three `@import`s are `@fontsource-variable/{inter,source-serif-4,jetbrains-mono}`, all in `index/fonts.json`; no image here is over 300 KB (the largest is `refs/aestudio/mobile.jpg` at 200 KB).

## Known gaps

- **Plugin root is write-protected in headless mode.** Run from the plugin checkout itself, every write to `.tasteful/` was refused as a "sensitive file", because the plugin directory is protected while it is loaded with `--plugin-dir`. Allow rules such as `Edit(.tasteful/**)` did not help. The runs therefore used a separate stand-in project, which is how the plugin is used in practice anyway. The two refused attempts are not kept.
- **Compound Bash commands are refused** under `Bash(node *)` / `Bash(bash *)` allow rules. Each run lost 2–3 turns to this before retrying with single commands. After the `find` runs, both skills were told to use one command per call; the `extract` run had that guidance.
- **The candidate pool overlaps.** With 56 index entries, aestudio and stash appear for all three briefs, and the piano brief has no truly playful pick (the run says so).
- **Piano combination A** takes only buttons and palette from #1, not "all".
- **The standard preview could not show new card classes.** The critic's first-pass blocker came from this, so `extract` wrote its own `cards-preview` render. The skill now says to express facets through existing classes. The preview also capped `.display` and used a middle-dot eyebrow, which the critic reported as nits. Both are fixed in `scripts/preview.mjs`. The previews kept here were made before those fixes.
- **No nav or footer component** exists in the contract, so those facets are not visible in any preview.
