# Build the `tasteful` Claude Code plugin

You are working inside a freshly cloned, empty git repository for a Claude Code plugin called **`tasteful`**. Build the whole plugin in this session: manifest, skills, agent, scripts, a seeded reference index, docs, and tests. Commit as you go in small commits on `main` (this is a new repo; no force-push, ever).

Everything in the repo (skills, docs, comments, index notes) is written in **English**. Conversational output of the skills follows the language the user writes the brief in.

Before writing code, read the official plugin docs so the structure matches the current spec, not your memory:

- https://code.claude.com/docs/en/plugins/create.md
- https://code.claude.com/docs/en/plugins/components.md
- https://code.claude.com/docs/en/plugins-reference (manifest fields)
- https://code.claude.com/docs/en/plugins/marketplace-reference.md
- https://code.claude.com/docs/en/skills (SKILL.md frontmatter)

Key facts already verified: the manifest lives at `.claude-plugin/plugin.json`; all other plugin files live at the plugin root; `skills/<name>/SKILL.md` is preferred over `commands/` for new plugins; `claude plugin validate .` is the authoritative check; `claude --plugin-dir <path>` loads a plugin from disk for testing; a `CLAUDE.md` at the plugin root is NOT loaded as context (put instructions in skills instead); the plugin name must not start with `claude-`/`anthropic-`.

---

## 1. What the plugin is for

I build many different websites on one personal framework: a pnpm monorepo of **Astro 7 + Tailwind 4** sites deployed to Cloudflare Workers. The repo is at `~/Documents/Business/alexaiarchitect/sites` (GitHub: `alexaiarchitect/sites`). Every site shares one design system living in a single file:

```
packages/theme/src/styles/theme.css
```

`tasteful` is a **taste-driven design-reference system**. Its job, in order:

1. **Find** — given a short brief for a new site, return 3–5 reference sites from a curated index, each with a link, a reason why it fits, and a concrete list of *what can be extracted from it* (type pairing, palette, card system, hero treatment, section rhythm, nav, footer, motion). The user may pick **one** reference or **combine several** ("typography from #1, palette from #3, cards from #4").
2. **Approve** — the user explicitly approves a selection. Nothing is extracted before approval.
3. **Extract** — turn the approved selection into **ready-to-apply styles**: a drop-in replacement for `theme.css` that keeps the framework's token and class contract (so all existing sites keep building), plus a report explaining every choice and where it came from.

The "taste" lives in two places: the curated index (what did not pass my filter is not in it) and a `taste.md` profile that the skills consult and that the user refines over time with feedback.

### Sources (and only these, for now)

| Source | Role | URL |
| --- | --- | --- |
| Awwwards | primary, juried, has scores + tags | https://www.awwwards.com/websites/ |
| CSS Design Awards | primary, juried, has scores | https://www.cssdesignawards.com/ |
| Behance "For You" feed | volume source, noisy | https://www.behance.net/ |
| Behance — Product Design category | volume source, better signal | https://www.behance.net/search/projects?field=product%20design (verify the real URL) |
| UNCOMMON (studio) | **taste anchor**, not a feed: its portfolio sites define the bar | https://uncommon.co/ (verify; the tab title was "Studio \| UNCOMMON") |

Explicitly **excluded**: TemplateMonster and any template marketplace. Do not add sources I have not listed; add a `sources.json` so I can add more later.

---

## 2. The target theme contract (read this carefully)

The extract step must produce CSS that the `sites` repo can consume **without changing any markup**. Learn the contract from the live file if it is available at `../sites/packages/theme/src/styles/theme.css` or `~/Documents/Business/alexaiarchitect/sites/packages/theme/src/styles/theme.css`. If it is not available, use this summary and also save a copy of it as `fixtures/theme.reference.css` when you can read it.

The current file is structured like this:

```css
@import "tailwindcss";
@source "../";
@import "@fontsource-variable/inter/wght.css";
@import "@fontsource-variable/source-serif-4/wght.css";

@theme {
  --font-sans, --font-display, --font-mono
  --color-bg, --color-panel, --color-panel-2, --color-ink, --color-muted,
  --color-line, --color-line-strong,
  --color-accent, --color-accent-ink, --color-accent-soft,
  --color-ok, --color-ok-soft, --color-bad, --color-bad-soft, --color-warn, --color-warn-soft
  --radius-card
  --shadow-card, --shadow-card-hover
  --ease-out-quint
}

@layer base {
  :root { color-scheme: light; --header-h: 3.5rem; }
  :root[data-theme="dark"] { ...dark overrides of every --color-* and --shadow-* ... }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ...same dark overrides... } }
  .only-dark / .only-light toggles
  html, body, main, h1–h6, p, a, :focus-visible, ::selection, prefers-reduced-motion
}

@layer components {
  .container-site, .container-prose, .skip-link,
  .eyebrow, .display, .lead,
  .card, .card-link, .card-link > a.stretched,
  .icon-tile, .btn, .btn-primary, .btn-sm,
  .chip, .chip-accent, .chip-ok, .chip-warn, .chip-outline,
  .value-pill, .mono, .divider, .num-badge, .hero-wash,
  .prose (+ h2, h3, ul, ol, li, blockquote, code, pre, img, hr, table, th, td, a, strong)
}

@utility panel { ... }
```

Hard rules for anything `extract` emits:

- **Same token names.** Every `--font-*`, `--color-*`, `--radius-*`, `--shadow-*`, `--ease-*` token that exists in the reference file must exist in the output with the same name. New tokens may be added; none may be removed or renamed.
- **Same class contract.** Every class listed above must still be defined. Their *visual* style may change completely; their *role* may not (`.btn-primary` is still the primary button, `.eyebrow` is still a small label above a heading, `.card-link` still lifts on hover unless the chosen direction is "no motion").
- **Dark mode is mandatory**, via the same two selectors (`:root[data-theme="dark"]` and the `prefers-color-scheme` fallback), with every color/shadow token overridden. If the reference site is dark-first, light mode is still produced (derive it, say so in the report).
- **Fonts are self-hosted via `@fontsource-variable/*` or `@fontsource/*`.** No Google Fonts `<link>`, no external CSS. If a reference uses a proprietary typeface, pick the closest open-source alternative, name both in the report, and prefer a *variable* font. The output must list the exact npm packages to add to `packages/theme/package.json`.
- **Keep `@import "tailwindcss";` and `@source "../";` as the first two lines.**
- **Accessibility floor:** `--color-ink` on `--color-bg` ≥ 7:1, `--color-muted` on `--color-bg` ≥ 4.5:1, `--color-accent-ink` on `--color-accent` ≥ 4.5:1, `--color-accent` on `--color-bg` ≥ 3:1, in *both* schemes. Compute it; do not eyeball it. The `sites` CI runs Lighthouse with accessibility ≥ 95, so this is not optional.
- Keep `prefers-reduced-motion` handling. Motion level is a brief parameter (0–3); level 0 means no transitions beyond color.
- No `!important` except the reduced-motion block that already exists.

The extract step does **not** modify the `sites` repo. It writes files into the *current project's* `.tasteful/` folder (see §5) and tells the user how to swap them in.

---

## 3. Repository layout to create

```
tasteful/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json          # so I can `/plugin marketplace add alexaiarchitect/tasteful`
├── skills/
│   ├── find/SKILL.md
│   ├── extract/SKILL.md
│   ├── add/SKILL.md
│   ├── refresh/SKILL.md
│   ├── rate/SKILL.md
│   └── check/SKILL.md
├── agents/
│   └── critic.md                 # independent reviewer for extract output
├── index/
│   ├── sources.json              # the five sources, with crawl entry points and notes
│   ├── sites.json                # the curated reference index (schema in §4)
│   ├── taste.md                  # the taste profile (§4)
│   └── schema.json               # JSON Schema for sites.json; validated by scripts/validate-index.mjs
├── scripts/
│   ├── probe.mjs                 # Playwright: fetch a URL, extract computed design facts + screenshots
│   ├── crawl-awwwards.mjs        # list candidate URLs from Awwwards category/tag pages
│   ├── crawl-cssda.mjs           # same for CSS Design Awards
│   ├── crawl-behance.mjs         # best effort; documents why it fails if it fails
│   ├── contrast.mjs              # WCAG contrast for a theme.css (both schemes); exit 1 on violation
│   ├── contract.mjs              # diff token/class contract between reference theme.css and a candidate
│   ├── validate-index.mjs        # schema + duplicate + dead-link check for index/sites.json
│   └── package.json              # deps: playwright, ajv (or similar). Installed into ${CLAUDE_PLUGIN_DATA}
├── fixtures/
│   ├── theme.reference.css       # copy of the sites theme (if readable) — the contract source of truth for tests
│   └── briefs/                   # 3 sample briefs used in tests
├── docs/
│   ├── WORKFLOW.md               # find → approve → extract → swap-in, with exact commands
│   ├── INDEX-SCHEMA.md           # human explanation of every field in sites.json
│   └── SITES-INTEGRATION.md      # how to apply a generated theme in the sites repo, step by step
├── README.md
├── LICENSE                       # MIT
└── .gitignore                    # node_modules, .tasteful/, screenshots
```

Do not create `commands/`. Do not put a `CLAUDE.md` at the root (it would not load, and `validate` warns about it).

### `plugin.json`

`name: "tasteful"`, `displayName: "Tasteful"`, `version: "0.1.0"`, description, author (name `alex`, use `git config user.name`/`user.email` if set), `repository` pointing at the remote from `git remote -v`, `license: "MIT"`, `keywords`. Declare `agents: ["./agents/critic.md"]`. Add a `userConfig`:

- `theme_path` (string, default `packages/theme/src/styles/theme.css`): path, relative to the project root, of the theme file whose contract `extract` must preserve.
- `output_dir` (string, default `.tasteful`): where proposals and generated themes are written in the project.
- `max_candidates` (number, default 5, min 3, max 8).

Reference these in skill bodies as `${user_config.theme_path}` etc. (verify the exact substitution syntax in the docs).

### `marketplace.json`

A minimal marketplace with one plugin entry whose `source` is the repo root, so installation is:

```
/plugin marketplace add alexaiarchitect/tasteful
/plugin install tasteful@tasteful
```

Verify the exact entry shape against the marketplace reference and put the resulting install commands in README.

---

## 4. The index and the taste profile

### `index/sites.json` — one entry per reference site

```jsonc
{
  "id": "kebab-unique-id",
  "url": "https://…",                       // the site itself, canonical, no tracking params
  "title": "…",
  "source": "awwwards | cssda | behance | uncommon | manual",
  "source_url": "https://…",                 // the award/project page where it was found
  "source_score": 7.9,                       // if the source gives one; null otherwise
  "added": "2026-10-24",
  "status": "live | dead | unchecked",
  "last_checked": "2026-10-24",
  "kind": ["landing", "product", "portfolio", "editorial", "ecommerce", "tool", "docs", "studio"],
  "mood": ["minimal", "editorial", "brutalist", "playful", "luxury", "technical", "warm", "corporate", "retro", "organic"],
  "typography": {
    "display": "serif | sans | mono | display | mixed",
    "body": "serif | sans | mono",
    "faces": ["Family names actually observed"],
    "open_alternatives": ["Fontsource-available equivalents"],
    "note": "one line: what makes the pairing work"
  },
  "color": {
    "strategy": "monochrome | accent-on-neutral | duotone | vivid | dark-first | warm-neutral | cold-neutral",
    "dominant": "#hex", "accent": "#hex", "ink": "#hex",
    "note": "one line"
  },
  "layout": {
    "grid": "single-column | 12-col | asymmetric | bento | full-bleed",
    "density": "airy | balanced | dense",
    "hero": "type-only | image | video | product-shot | split | wash",
    "note": "one line"
  },
  "motion": 0,                                 // 0 none · 1 subtle hover/fade · 2 scroll-driven · 3 heavy/WebGL
  "extractable": ["type-pairing", "palette", "card-system", "hero", "section-rhythm", "nav", "footer", "buttons", "chips", "motion", "spacing-scale"],
  "why": "One or two sentences: why this is in the index. Concrete, no filler.",
  "avoid": "Optional: what NOT to copy from it (e.g. 'the 3D hero is too heavy for a content site').",
  "screenshots": { "desktop": "…", "mobile": "…" }   // optional paths under index/shots/, gitignored unless small
}
```

Write `index/schema.json` for this and enforce it in `scripts/validate-index.mjs` (also: unique ids, unique urls, `status: dead` entries flagged).

### Seeding the index (do this in the session, for real)

Target **40–60 verified, live entries** at the end of this session. Quality over count. Procedure:

1. Run the crawlers against Awwwards (Sites of the Day, Sites of the Month, Developer Award, and the tags `minimal`, `typography`, `portfolio`, `e-commerce`, `editorial`, `startup`) and CSSDA (WOTD/WOTM, Best Innovation, Best UX, Best UI), collecting at least 150 raw candidate URLs with their award page and score.
2. Try Behance. It is JS-rendered and bot-protected; attempt it with Playwright once, and if it yields nothing usable in reasonable time, record exactly what happened in `docs/INDEX-SCHEMA.md` → "Behance" and make `/tasteful:add <url>` the supported path for Behance finds. Do not burn more than ~15 minutes on it.
3. Fetch UNCOMMON's portfolio and add every client site that is live as `source: uncommon`. These are **anchor** entries: they get `"anchor": true` and `find` weighs them higher.
4. For each candidate, run `scripts/probe.mjs` to get real facts (font families from computed styles, top colors by area, border radii, shadows, viewport screenshots at 1440×900 and 390×844). Tag the entry from those facts plus your own reading of the screenshots. Entries whose site is dead, is a template demo, is an agency *selling* templates, or is a pure WebGL showpiece with no reusable system, are dropped — note the drop reason in a `index/rejected.json` (url + one-line reason) so `refresh` never re-proposes them.
5. Apply the taste profile (below) as the final filter. If you are unsure whether an entry passes, keep it but add `"tentative": true`.

### `index/taste.md` — the taste profile

Write it as rules a designer would actually give, grounded in the current `theme.css` (which is my current baseline: neutral warm-grey light scheme, Inter body + Source Serif 4 display, one blue accent, 1rem card radius, soft layered shadows, `ease-out-quint`, restrained motion) and in the UNCOMMON portfolio as the upper bar. Structure:

- **Likes** (concrete: "editorial serif display with a quiet sans body", "one accent, used sparingly", "generous whitespace with a strong type scale", "sections that read as a sequence, not a stack of cards"...)
- **Dislikes** ("template-looking SaaS hero with three feature cards", "gradient blobs", "more than two typefaces", "motion that blocks reading", "stock illustration", "dark-mode-only")
- **Non-negotiables** (the accessibility floor, self-hosted fonts, trilingual sites so text-heavy layouts must survive Russian and Spanish word lengths — Cyrillic coverage in fonts matters)
- **Weights** used by `find` when ranking (anchor bonus, source score, tag match, taste match, recency)

`/tasteful:rate` appends to a "Feedback log" section at the bottom and, when a pattern repeats, promotes it into Likes/Dislikes.

---

## 5. Skills — exact behaviour

All skills must have frontmatter with `name`, `description` (written so Claude triggers it from natural language too, e.g. "find design references for…"), and `argument-hint` where applicable. Each skill tells Claude which scripts to run and with which arguments; scripts are invoked as `node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs"` after ensuring deps are installed into `${CLAUDE_PLUGIN_DATA}` (write a tiny `scripts/ensure-deps.sh` that `npm ci`s there once; never install into `${CLAUDE_PLUGIN_ROOT}`). Playwright + Chromium must be installed on first use into `${CLAUDE_PLUGIN_DATA}` as well; if the install fails, scripts fall back to plain `fetch` + HTML parsing and say so.

### `/tasteful:find <brief>`

Input: a free-text brief. If the brief lacks any of these, ask for them in **one** question with sensible defaults, then proceed: site kind, audience, tone (3 adjectives), content density (text-heavy / balanced / visual), motion budget 0–3, dark-mode preference (both / light-first / dark-first), and any must-have components.

Process:
1. Parse the brief into the same tag vocabulary as `sites.json`.
2. Score every `live` entry: tag overlap, taste weights from `taste.md`, anchor bonus, source score, penalty for `avoid` conflicts and motion above budget.
3. Return the top `max_candidates`, **diverse** (never two entries with the same mood+typography combination; prefer one safe pick, one bolder pick).
4. For each candidate print: title, url, source link, one-paragraph *why it fits this brief*, a bullet list of **what to take** (from `extractable`, filtered by relevance), and one line **what to leave**.
5. Then propose **2–3 combinations** ("A: #1 alone", "B: typography of #2 + palette of #1 + cards of #3"), each with one sentence on the resulting character.
6. Write all of this to `${output_dir}/<brief-slug>/proposal.md` (and `proposal.json` with the structured selection), and end with: *"Reply with your choice, e.g. `approve B` or `approve 1, palette from 3`, then run `/tasteful:extract <brief-slug>`."*

Live verification: before presenting, `probe` each candidate quickly (HEAD/GET) and silently replace any dead one with the next in rank, updating `status` in the index.

### `/tasteful:extract <brief-slug> [approval text]`

Refuses to run if there is no approval: either the argument contains one, or the user approves when asked. The approval is stored in `${output_dir}/<brief-slug>/approval.md` verbatim.

Process:
1. Read the project's theme at `${user_config.theme_path}` → derive the **contract** (token names, class names, dark-mode selectors) with `scripts/contract.mjs`. If the file is missing, use `fixtures/theme.reference.css` and warn.
2. For each approved reference, run `scripts/probe.mjs --deep` → fonts (families, weights used, sizes of h1/h2/body, line-heights, letter-spacing), palette (bg, surface, text, muted, accent, lines — by computed style and area), radii, shadows, spacing rhythm (vertical gaps between sections), button/chip/card styles, nav height, container max-width, motion (transition durations/easings seen in stylesheets).
3. Compose according to the approval ("typography from X" means only typography facts come from X).
4. Emit into `${output_dir}/<brief-slug>/`:
   - `theme.<brief-slug>.css` — full replacement for `theme.css`, honouring every rule in §2. Every token gets a trailing comment `/* from: <ref-id> — <what> */` or `/* derived */`.
   - `fonts.json` — the `@fontsource-variable/*` packages to add, with the import lines.
   - `REPORT.md` — per section: what was borrowed from where (with the probe evidence: observed values → chosen values), what was derived (e.g. light scheme from a dark-first site), contrast table for both schemes, deviations from the taste profile and why, and a "known gaps" list.
   - `preview.html` — a static page that imports nothing external and inlines the generated tokens + component classes (plain CSS, no Tailwind needed) to render: hero with eyebrow/display/lead, two `.btn`, chips, three `.card-link`, a `.prose` block with headings/list/blockquote/code/table, in light and dark side by side. Screenshot it with Playwright to `preview-light.png` / `preview-dark.png`.
5. Run `scripts/contract.mjs --check` and `scripts/contrast.mjs` on the output; if either fails, fix and re-run — do not hand over a failing theme.
6. Hand the result to the **`tasteful:critic`** agent (below) and apply its findings.
7. Finish with the swap-in instructions from `docs/SITES-INTEGRATION.md` (copy file over `theme.css` on a branch, add fonts to `packages/theme/package.json`, `pnpm install`, `pnpm run build && pnpm run check`, open preview, Lighthouse via the PR). Never perform the swap-in itself.

### `/tasteful:add <url> [source-url]`

Probe the URL, propose a fully tagged entry, show it, ask to confirm, append to `sites.json`, run `validate-index.mjs`. This is the manual path for Behance and anything found elsewhere.

### `/tasteful:refresh [source]`

Run the crawlers, diff against `sites.json` + `rejected.json`, probe new candidates, present them in batches of 10 with a one-line verdict each (keep / reject + reason), apply only what the user confirms. Never adds silently.

### `/tasteful:rate <id|url> +|- [note]`

Append to the feedback log in `taste.md`; `-` with a note also sets `avoid` or removes the entry (ask which). After three consistent signals, propose a new rule for Likes/Dislikes.

### `/tasteful:check`

Probe every entry, update `status`/`last_checked`, report dead ones, refresh screenshots for changed ones.

### `agents/critic.md`

A reviewer agent that has **not** seen the extraction process. Input: the generated `theme.*.css`, `REPORT.md`, `preview-*.png`, the reference `theme.css`, and `taste.md`. It must answer, with evidence: contract preserved? contrast floor met in both schemes? fonts self-hosted and Cyrillic-capable? does the preview actually look like the approved references (it should look at the screenshots of the references too)? anything that reads as template/default? Output: a numbered list of blocking issues and nits. `extract` fixes blockers before finishing.

---

## 6. Scripts — requirements

- Node ≥ 22, ESM, no TypeScript build step. Deps in `scripts/package.json`, installed into `${CLAUDE_PLUGIN_DATA}/node_modules` by `ensure-deps.sh` (symlink or `NODE_PATH`, whichever is reliable; document it).
- `probe.mjs <url> [--deep] [--out dir]` prints JSON to stdout; `--deep` also writes screenshots. Must handle: cookie banners (dismiss common ones by text), lazy fonts (wait for `document.fonts.ready`), sites that block headless (fall back to fetch + CSS parsing, mark `"mode": "static"`). Timeouts: 30 s per page; never hang.
- `contrast.mjs <theme.css>` parses `@theme` and both dark selectors, computes WCAG 2.x contrast for the pairs listed in §2, prints a table, exits non-zero on failure.
- `contract.mjs <reference.css> <candidate.css> [--check]` lists missing/renamed tokens and classes; `--check` exits non-zero if anything is missing.
- Crawlers accept `--limit`, print JSON lines `{url, source_url, score, tags}`, and are polite (1 req/s, a real UA string, respect robots.txt disallows).
- All scripts have `--help`.

---

## 7. Docs

- `README.md`: what it is (3 lines), install (marketplace + `--plugin-dir`), the five commands with one example each, the find→approve→extract flow in 6 lines, the theme contract summary, how to add sources.
- `docs/WORKFLOW.md`: the full flow with real example output (use one of your test runs).
- `docs/SITES-INTEGRATION.md`: exact steps to apply a generated theme in the `sites` repo, including the `@fontsource` packages, the `@source` caveat, and the checks to run (`pnpm run build && pnpm run check`, Lighthouse via PR preview).
- `docs/INDEX-SCHEMA.md`: every field, allowed values, how tags are assigned, Behance notes, how `rejected.json` works.

---

## 8. Tests and acceptance (run them, don't just write them)

1. `claude plugin validate .` → **Validation passed** (no warnings; fix any).
2. `node scripts/validate-index.mjs` → passes on the seeded index.
3. `node scripts/contrast.mjs fixtures/theme.reference.css` → passes (if it doesn't, the script is wrong, not the theme — it ships today with Lighthouse a11y ≥ 95).
4. `node scripts/contract.mjs fixtures/theme.reference.css fixtures/theme.reference.css --check` → passes; then against a copy with one token renamed → fails with a clear message.
5. End-to-end, inside this repo with `fixtures/` standing in for the project: run the `find` skill on each of the three briefs in `fixtures/briefs/` (write them yourself: (a) a trilingual blog + landing for an AI-architecture consultant, text-heavy, motion 1; (b) a piano note-reading trainer, tool, playful but calm, motion 1; (c) a DJI camera settings guide, docs/tool, dense, motion 0). Save the proposals under `fixtures/runs/`.
6. Approve a *combination* for brief (a) and run `extract` with `theme_path` pointed at `fixtures/theme.reference.css`. The result must pass `contract --check`, `contrast`, and the critic; commit the run output under `fixtures/runs/` (screenshots included, keep them under 300 KB each).
7. Add a `scripts/test.sh` that runs 1–4 so I can run it in one go, and a GitHub Actions workflow `.github/workflows/check.yml` that runs it on push (install Claude Code CLI in CI only if it is straightforward; otherwise run just the node checks there and say so in a comment).

---

## 9. How to work

- Start by posting a short plan and a task list; then execute without waiting for approval, except: ask me before anything that would cost money or hit a site aggressively.
- Commit after each major piece (manifest, scripts, index seed, skills, docs, tests). Conventional commit messages.
- When a source cannot be crawled, document the fact and the fallback instead of stubbing fake data. **No fabricated entries in the index** — every entry must have been probed live in this session.
- When done, give me: the final tree, the commands to install and try it from the `sites` repo (`cd ~/Documents/Business/alexaiarchitect/sites && claude --plugin-dir ~/path/to/tasteful`), the index stats (entries per source, per kind, anchors), and the list of anything you could not complete and why.
