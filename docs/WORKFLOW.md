# Workflow: find → approve → extract → swap in

This is the full path from a brief to a new theme in the `sites` repo. Every step writes into the current project's `.tasteful/` folder (the `output_dir` user setting); nothing touches the `sites` repo until you swap the theme in yourself.

Placeholders: `<slug>` is the brief slug chosen by `find` (e.g. `ai-architect-blog`); `<n>` is a candidate number from the proposal.

## 0. Start Claude Code with the plugin

From the project whose theme you want to replace (normally the `sites` repo):

```sh
cd ~/Documents/Business/alexaiarchitect/sites
claude --plugin-dir ~/Documents/Business/alexaiarchitect/tasteful   # or: /plugin install tasteful@alexaiarchitect-tasteful
```

The first script run installs npm deps (and, for probes with screenshots, Chromium) into the plugin data dir via `scripts/ensure-deps.sh`. If Chromium cannot be installed, probes fall back to static fetch + CSS parsing and say so.

## 1. Find

```
/tasteful:find A trilingual blog + landing for an independent AI-architecture consultant. Audience: CTOs. Calm, precise, warm. Text-heavy, motion 1, both schemes. Must have: prose, quiet nav, article cards.
```

Natural language works too: "find design references for a settings guide for a camera".

What happens:

1. The brief is parsed into index tags. If a field is missing (kind, audience, tone, density, motion 0–3, dark mode, must-haves), you get **one** question with defaults.
2. `.tasteful/<slug>/brief.json` is written and ranked:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/rank.mjs" --brief .tasteful/<slug>/brief.json --n 5 --data "${CLAUDE_PLUGIN_DATA}"
   ```

3. Each candidate is quick-probed (`probe.mjs --batch … --quick`); dead ones are marked `dead` in the index and replaced by the next in rank.
4. `.tasteful/<slug>/proposal.md` and `proposal.json` are written: 3–5 candidates (title, url, source link, why it fits, what to take, what to leave) and 2–3 combinations.

Example proposal (excerpt):

<!-- filled from fixtures/runs after the e2e run -->

The reply always ends with:

> Reply with your choice, e.g. `approve B` or `approve 1, palette from 3`, then run `/tasteful:extract <brief-slug>`.

## 2. Approve

Approve in the chat or pass the approval as an argument; both are stored verbatim in `.tasteful/<slug>/approval.md`.

```
/tasteful:extract <slug> approve B
/tasteful:extract <slug> approve 1, palette from 3, cards from 4
```

Without an approval, `extract` asks; if you do not approve, it stops and writes nothing.

## 3. Extract

What happens, in order:

1. The contract is read from `theme_path` (default `packages/theme/src/styles/theme.css`); if that file is missing, `fixtures/theme.reference.css` is used and you are warned.
2. Each approved reference is deep-probed (fonts, type scale, palette by area, radii, shadows, rhythm, motion, desktop and mobile screenshots), or a fresh cached probe from `index/probes/<id>.json` is reused.
3. Faces are mapped to open `@fontsource` packages with `fonts.mjs` (variable and Cyrillic preferred).
4. The theme is composed per facet and written with provenance comments on every token.
5. Checks run until both pass:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/contract.mjs" packages/theme/src/styles/theme.css .tasteful/<slug>/theme.<slug>.css --check
   node "${CLAUDE_PLUGIN_ROOT}/scripts/contrast.mjs" .tasteful/<slug>/theme.<slug>.css --suggest
   ```

6. The `tasteful:critic` agent reviews the files without seeing the process; blockers are fixed and the checks re-run.

Output in `.tasteful/<slug>/`:

| File | What it is |
| --- | --- |
| `approval.md` | Your approval, verbatim, plus the facet → reference map |
| `theme.<slug>.css` | Drop-in replacement for `theme.css`; every token commented `/* from: <id> — … */` or `/* derived */` |
| `fonts.json` | `@fontsource` packages to add and their import lines |
| `REPORT.md` | What came from where (observed → chosen), derived values, contrast table, deviations, critic outcome, known gaps |
| `preview.html`, `preview-light.jpg`, `preview-dark.jpg` | Self-contained preview of the components in both schemes |
| `probe-<id>.json`, `refs/<id>/` | Probe facts and screenshots of each reference |

Example check output and report excerpt:

<!-- filled from fixtures/runs after the e2e run -->

To re-check a theme later without re-extracting:

```
/tasteful:extract verify .tasteful/<slug>/theme.<slug>.css
```

## 4. Swap in

`extract` prints the steps but never performs them. Follow [SITES-INTEGRATION.md](SITES-INTEGRATION.md): a `feat/theme-<slug>` branch, copy the theme over `packages/theme/src/styles/theme.css`, add the fonts, `pnpm install`, build, check, lint, eyeball, open a PR for the Workers preview and Lighthouse.

## Keeping the index good

| Command | When |
| --- | --- |
| `/tasteful:rate <id> + note` / `- note` | After a proposal: say what you liked or not; three consistent signals become a proposed rule in `taste.md` |
| `/tasteful:add <url> [source-url]` | You found a site yourself (Behance: `/tasteful:add behance`) |
| `/tasteful:refresh [source]` | Every few weeks, to review new award winners in batches of 10 |
| `/tasteful:check` | Before a big `find` session, to drop dead sites |

These edit the plugin's own `index/` files. With a marketplace install those live in the plugin cache and are replaced on update, so keep a personal index in a checkout (`--plugin-dir`) or a fork.
