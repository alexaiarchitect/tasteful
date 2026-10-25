# Workflow: find → approve → extract → swap in

This is the full path from a brief to a new theme in the `sites` repo. Every step writes into the current project's `.tasteful/` folder (the `output_dir` user setting); nothing touches the `sites` repo until you swap the theme (or a site layer) in yourself.

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

From the recorded run for brief (a) (`fixtures/runs/ai-architect-blog/proposal.md`, 2026-10-24, trimmed):

```markdown
## 1. GoShuin: Goshuin Map & Journal for iPhone (safe pick)
https://aestudio.studio/goshuin/en · [source](https://www.awwwards.com/sites/goshuin-every-stamp-a-memory)

**Why it fits.** The closest match to "calm, precise, warm": a Georgia serif title page,
hairline bronze rules and underlined text links instead of filled buttons. Airy layout,
motion level 1 with a pause-motion control.

**What to take**
- type-pairing: serif display (Georgia → Source Serif 4, Cyrillic) over system sans (→ Inter)
- palette: paper #f8f3e7, slate ink #2d3435, bronze #756449 for rules only
- buttons: underlined text links as the primary CTA style
…
**What to leave:** the pixel-dithered pattern art and the 129px display.

## 2. Half the Sky — https://halfthesky.app/        (palette, nav, card grid)
## 3. The Quaker School at Horsham (bold pick)       (serif + sans sibling, chapter rhythm)
## 4. Stash — https://stash.cool/                    (horizontal article cards, mono meta)
## 5. Farm Minerals — https://www.farmminerals.com/  (bone/olive duotone, outlined CTA)

## Combinations
- A: #1 alone. The calmest option and the closest to the brief.
- B: typography of #1 + palette of #2 + cards of #4. Source Serif 4 / Inter over a warm
  stone ground, with Stash's ruled horizontal cards and mono meta.
- C: nav, buttons, type and rhythm of #1 + nav of #3. The most restrained top bar.
```

The other two briefs produced: piano trainer → aestudio, yigua, stash, almadalabel, estudioniksen; DJI guide → stash, aestudio, yigua, enricbadrinas, almadalabel. All candidates answered the liveness probe, so nothing was replaced.

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

From the recorded run (`fixtures/runs/ai-architect-blog/`, approval `approve B`, trimmed).

`approval.md`:

```markdown
approve B

## Resolved
Combination B: typography of #1 + palette of #2 + cards of #4. Facets not named in B
come from the first reference named (#1 aestudio).
| Facet | Reference |
| --- | --- |
| typography | aestudio (#1) |
| palette | halfthesky (#2) |
| cards | stash (#4) |
| buttons, chips, hero, rhythm, nav, footer, motion | aestudio (#1) |
```

The project had no `packages/theme/src/styles/theme.css`, so `extract` said so and used `fixtures/theme.reference.css` as the contract. Final checks:

```text
$ node scripts/contract.mjs fixtures/theme.reference.css …/theme.ai-architect-blog.css --check
ok   1. @theme tokens            ok   5. first two statements are @import "tailwindcss"; and @source "../";
ok   2. classes                  ok   6. !important only inside prefers-reduced-motion
ok   3. @utility names           ok   7. no external @import
ok   4. dark coverage (--color-*, --shadow-*)
info: added tokens: --ease-out · added classes: .card-media, .card-meta, .card-title
ok: contract preserved
```

`REPORT.md` → Contrast (required pairs):

| Scheme | ink / bg | muted / bg | accent-ink / accent | accent / bg |
| --- | --- | --- | --- | --- |
| light | 8.43 | 5.19 | 7.41 | 6.26 |
| dark | 11.71 | 6.74 | 9.19 | 9.19 |
| floor | 7 | 4.5 | 4.5 | 3 |

Every token line carries provenance, for example `--color-bg: #dddcd7; /* from: halfthesky — stone ground, 100% of background area */`, and in the dark block `--color-bg: #262521; /* derived — dark stone, same warm hue as #dddcd7; halfthesky is light-only */`.

Critic (`tasteful:critic`), two passes:

```text
Pass 1 — BLOCKED (1): the preview carries aestudio's typography and Half the Sky's stone
palette, but the Stash card treatment cannot be seen.
Pass 2 — PASS: Source Serif at weight 400 over Inter, halfthesky's #dddcd7 stone with
#3a3934 ink, and Stash-style rule-topped zero-radius cards with a mono meta line.
```

The hand-over ends with the swap-in steps, filled in with the real slug and packages (never run by the plugin):

```sh
git switch -c feat/theme-ai-architect-blog
cp .tasteful/ai-architect-blog/theme.ai-architect-blog.css packages/theme/src/styles/theme.css
pnpm --filter @sites/theme add @fontsource-variable/inter @fontsource-variable/source-serif-4 @fontsource-variable/jetbrains-mono
pnpm install
pnpm run build && pnpm run check && pnpm run lint
pnpm --filter www dev        # landing, a long post, /ru/, /es/, dark mode
```

To re-check a theme later without re-extracting:

```
/tasteful:extract verify .tasteful/<slug>/theme.<slug>.css
```

## 3b. Site layer

When the brief carries `"site": "dji"` (find offers it when the project has `apps/*/` folders and the brief names one, or says "only for <site>", "site layer" or "overlay"), the look is for one app only. `extract` still composes and checks the full theme as above, then derives the layer from it and checks the layer against the shared base:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/overlay.mjs" packages/theme/src/styles/theme.css .tasteful/<slug>/theme.<slug>.css \
  --out .tasteful/<slug>/site.<slug>.css --site dji --slug <slug> --approval "approve B" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/contract.mjs" packages/theme/src/styles/theme.css .tasteful/<slug>/site.<slug>.css --overlay --check
node "${CLAUDE_PLUGIN_ROOT}/scripts/contrast.mjs" packages/theme/src/styles/theme.css --overlay .tasteful/<slug>/site.<slug>.css --suggest
```

`overlay.mjs` exits 1 when the theme does not differ from the base (no layer is written). Fixes always go into `theme.<slug>.css`, after which the layer is regenerated; the layer is never edited by hand. A layer cannot delete a base declaration, so `overlay.mjs` resets each one the full theme deleted with `<prop>: unset; /* removed in the full theme */` at the top of the rule (listed under `removed`), and inlines `var()` references to tokens that exist only in the full theme with their value (listed under `inlined`). A layer therefore never references a token the base lacks; `contract.mjs --overlay` check 8 enforces it. The critic reviews both files, and REPORT.md gains a "Site layer" section (counts of overridden tokens, base and component rules, new fonts; what stays shared; removed and inlined counts).

Layer layout, top to bottom: header comment, new `@fontsource` imports, one unlayered `:root` with the changed tokens, both dark selectors with identical values, `@layer base { … }`, `@layer components { … }`. Excerpt from the real dji layer (2026-10-25, `overlay.mjs` on the `dji-device-skill-tree` run against the shared theme: 20 light tokens, 18 dark, 7 base rules, 29 component rules, one new font import, two `unset` resets, nothing inlined; trimmed):

```css
/* Site layer for dji — generated by tasteful from theme.dji-device-skill-tree.css (approval: approve B). Overrides the shared theme; token names never change. Import order in the app: "@sites/theme/styles.css", then this file, then BaseLayout. */

@import "@fontsource-variable/jetbrains-mono/wght.css";

:root {
  --font-mono: "JetBrains Mono Variable", ui-monospace, "SF Mono", Menlo, Consolas, monospace; /* from: stash — Space Mono card titles, meta and [ ← ] pagers; JetBrains Mono adds Cyrillic */
  --color-bg: #f3f0e8; /* from: yigua — page background, 99.5% of the area */
  /* … 13 more --color-* tokens, --radius-card, both --shadow-* … */
}

:root[data-theme="dark"] {
  --color-bg: #171815; /* from: yigua — the Cast pill colour becomes the surface */
  --color-ink: #f3f0e8; /* from: yigua — the paper becomes the ink */
  --color-muted: #a9a69c; /* derived — warm grey, 7.3:1 on the dark surface */
  /* … 15 more, identical to the block below */
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg: #171815; /* from: yigua — the Cast pill colour becomes the surface */
    --color-ink: #f3f0e8; /* from: yigua — the paper becomes the ink */
    --color-muted: #a9a69c; /* derived — warm grey, 7.3:1 on the dark surface */
    /* … */
  }
}

@layer base {
  /* from: aestudio — Georgia headings at weight 400 with tight tracking (h1 -0.07em, h2 -0.02em); the weight contrast with the sans body does the work. */
  h1, h2, h3 {
    font-family: var(--font-display);
    font-weight: 420;
    letter-spacing: -0.02em;
    text-wrap: balance;
    line-height: 1.12;
    overflow-wrap: anywhere;
    hyphens: auto;
  }
  /* … */
}

@layer components {
  .eyebrow::before {
    border-radius: unset; /* removed in the full theme */
    content: "";
    width: 1.5rem;
    height: 1px;
    background: var(--color-line-strong);
  }
  /* … */
}
```

To re-check a layer later: `/tasteful:extract verify packages/theme/src/styles/theme.css apps/dji/src/styles/site.css`, or just the layer path (a file that does not start with `@import "tailwindcss"` is treated as a layer over `theme_path`).

## 4. Swap in

`extract` prints the steps but never performs them. Follow [SITES-INTEGRATION.md](SITES-INTEGRATION.md), which starts with "Which path?":

- **Path A, shared theme** (no `site` in the brief): a `feat/theme-<slug>` branch, copy the theme over `packages/theme/src/styles/theme.css`, `pnpm --filter @sites/theme add` the fonts, `pnpm install`, build, check, lint, eyeball every app, and a PR with the `shared-theme` label for the Workers preview and Lighthouse.
- **Path B, site layer** (`site` set): copy `site.<slug>.css` to `apps/<site>/src/styles/site.css` (the `site_layer_path` setting), `pnpm --filter <site> add` only the fonts new in the layer, keep the Shell.astro import order (`@sites/theme/styles.css`, then `../styles/site.css`, then BaseLayout), build, check, eyeball that app, and a PR without the label.

## Keeping the index good

| Command | When |
| --- | --- |
| `/tasteful:rate <id> + note` / `- note` | After a proposal: say what you liked or not; three consistent signals become a proposed rule in `taste.md` |
| `/tasteful:add <url> [source-url]` | You found a site yourself (Behance: `/tasteful:add behance`) |
| `/tasteful:refresh [source]` | Every few weeks, to review new award winners in batches of 10 |
| `/tasteful:check` | Before a big `find` session, to drop dead sites |

These edit the plugin's own `index/` files. With a marketplace install those live in the plugin cache and are replaced on update, so keep a personal index in a checkout (`--plugin-dir`) or a fork.
