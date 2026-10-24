# ai-architect-blog: extract report

Contract source: `fixtures/theme.reference.css` (the project has no `packages/theme/src/styles/theme.css`). **Warning:** re-run `/tasteful:extract verify ai-architect-blog` against the real sites theme before swapping in.

Probes: the cached `index/probes/{aestudio,halfthesky,stash}.json` were reused (all probed 2026-10-24, screenshots present). Deps: Playwright available, no static fallback.

## 1. Approval

> approve B

Combination B is typography of #1, palette of #2 and cards of #4. Facets not named come from the first reference named (#1 aestudio).

| Facet | Reference |
| --- | --- |
| typography | aestudio |
| palette | halfthesky |
| cards | stash |
| buttons, chips, hero, section-rhythm, spacing-scale, nav, footer, motion | aestudio |

## 2. Per facet

**Typography (aestudio).**
- Observed: h1 Georgia 400 at 129px with −9px tracking (−0.07em); h2 Georgia 400 36px, −0.02em; body −apple-system 16/29.6 (1.85); small tracked caps for metadata.
- Chosen:
  - Source Serif 4 at weight 400 for h1–h3, `.display` and `.lead`.
  - `.display` tracking −0.04em. The −0.07em was halved so long RU/ES words stay legible at smaller sizes; the display size itself is left to the markup.
  - h1–h3 at −0.02em, as the observed h2.
  - Body is Inter at 1.7 (1.75 in `.prose`), slightly tighter than the observed 1.85 because the brief is text-heavy and the measure is 68ch.
  - `.eyebrow` uses 0.6875rem caps at 0.16em tracking under a hairline rule, like "AE STUDIO / GOSHUIN JOURNAL".

**Palette (halfthesky).**
- Observed: background `#dddcd7` (100% of area); text `#66645c` (95%), `#3a3934` (darkest) and `#8a887f`; inset white highlights at 35% on the tiles.
- Chosen:
  - bg `#dddcd7`.
  - ink `#3a3934`, 8.43:1.
  - muted `#5a5850`, darkened from `#66645c`, which measured 4.35:1 and failed the 4.5:1 floor, as the proposal warned.
  - panel `#e8e7e3`, the bg lifted by the 35% white highlight.
  - line `#c6c5be`, the grid hairline read from the screenshot.

**Cards (stash).**
- Observed: radius 0, no border box, no shadow, black section rules, a `#f1f1f1` media frame, a Space Mono uppercase meta line ("TOOLS · 5 MIN READ · OCT 2026"), a title and a grey dek.
- Chosen:
  - `--radius-card: 0` and `--shadow-card` transparent.
  - `.card` is a 1px ink top rule with no fill, plus the new `.card-media` (panel-2 frame, 3:2) and `.card-meta` (JetBrains Mono, uppercase, muted).
  - The grey dek uses `--color-muted` (5.19:1) instead of Stash's `#8a8a8a`.
  - `.card-link` hover: lifts 2px, and the rule thickens to 2px through `--shadow-card-hover: 0 -1px 0 0 ink`. Stash itself does not lift; the lift is kept for the `.card-link` role at motion level 1.
  - `.card > .btn` sits at the start of the row and at the foot of the card, as a text-link CTA (Stash's "[ READ ↗ ]").
  - Evidence: `cards-preview.html` with `cards-preview-light.jpg`, `cards-preview-dark.jpg` and `cards-preview-light-hover.jpg`. The standard preview's fixed markup does not use the new card classes, so these cards were rendered separately from a copy of `preview.html` with only the card row replaced. Two artefacts are scaffold only: the preview's own `.card a.stretched { margin-top }` misaligns the CTAs, and the dark shot is cropped at its right edge.

**Buttons (aestudio).**
- Observed: "App Store ↗" / "Explore the app" are underlined text links with 0px radius.
- Chosen: `.btn` is a transparent text link with a 1px line-strong underline that turns ink on hover. `.btn-primary` is a filled square in the accent; see Deviations.

**Chips (aestudio).**
- Observed: the "Pause motion" pill is 999px radius, 1px `#8c938a` border, `#f4f2eb` fill and regular weight.
- Chosen: `.chip` is 999px, panel fill, line-strong border, weight 400.

**Hero (aestudio).**
- Observed: a title page with no wash, framed by hairline rules.
- Chosen: the gradient wash is removed (`.hero-wash::before { content: none }`). The top rule comes from `.eyebrow` and the bottom one from the card rules, which avoids doubled hairlines.

**Section rhythm and spacing (aestudio).** Observed section gaps of 35 and 70px became the new tokens `--spacing-block: 2.25rem` and `--spacing-section: 4.5rem`.

**Nav (aestudio).** An observed top bar of about 52px became `--header-h: 3.25rem`. The nav markup lives in the sites repo.

**Motion (aestudio).**
- Observed: transitions of 160–250ms with `ease` / `ease-out`; level 1.
- Chosen: the new `--ease-out: cubic-bezier(0, 0, 0.58, 1)` is used by every component transition. `--ease-out-quint` keeps the baseline quint value for markup that names it.
- New tokens `--duration-fast: 160ms` and `--duration-base: 220ms`.
- The `prefers-reduced-motion` block is kept.

**Footer.** Nothing was observable as a reusable rule (aestudio's footer is a page-turn bar), so it stays at the baseline.

## 3. Derived

- **Accent `#5a4a26`.** Half the Sky has no accent colour, so this was derived from its warm hue, pushed to a dark bronze so that links separate from ink. It gives 6.26:1 on bg and 7.41:1 against accent-ink `#efeeea`. accent-soft is `#d2c9b2`.
  - The first draft used `#4d4636`; the critic found it too close to ink.
  - The bronze is close to aestudio's `#756449` rules but was chosen for separation from ink, not borrowed.
- **line-strong, panel-2, ok/bad/warn and their soft variants.** Tuned to the stone ground; the advisory pairs are all ≥ 5:1.
- **The whole dark scheme.** Half the Sky is light-only. The dark scheme is a warm dark stone, bg `#262521` (same hue as `#dddcd7`), not a neutral `#111`. Ink is `#e2e1db`, muted `#aeaca3`, line `#45443d`, and the accent is light bronze `#d9c79a`.

## 4. Fonts

| Observed | Open alternative | Package | Variable | Cyrillic |
| --- | --- | --- | --- | --- |
| Georgia (aestudio display) | Source Serif 4 | `@fontsource-variable/source-serif-4` | yes | yes |
| -apple-system (aestudio body) | Inter | `@fontsource-variable/inter` | yes | yes |
| Space Mono (stash card meta) | JetBrains Mono | `@fontsource-variable/jetbrains-mono` | yes | yes |

Space Mono has `cyrillic: false`. JetBrains Mono was picked over IBM Plex Mono because it has Cyrillic and a variable build. The registry was verified.

## 5. Contrast (`contrast.mjs --extended`)

| Scheme | Pair | Ratio | Min | Required |
| --- | --- | --- | --- | --- |
| light | ink / bg | 8.43 | 7 | yes |
| light | muted / bg | 5.19 | 4.5 | yes |
| light | accent-ink / accent | 7.41 | 4.5 | yes |
| light | accent / bg | 6.26 | 3 | yes |
| light | ink / panel | 9.35 | 7 | advisory |
| light | muted / panel | 5.76 | 4.5 | advisory |
| light | ok / ok-soft | 5.03 | 4.5 | advisory |
| light | bad / bad-soft | 5.20 | 4.5 | advisory |
| light | warn / warn-soft | 5.10 | 4.5 | advisory |
| light | accent / panel | 6.95 | 3 | advisory |
| dark | ink / bg | 11.71 | 7 | yes |
| dark | muted / bg | 6.74 | 4.5 | yes |
| dark | accent-ink / accent | 9.19 | 4.5 | yes |
| dark | accent / bg | 9.19 | 3 | yes |
| dark | ink / panel | 10.52 | 7 | advisory |
| dark | muted / panel | 6.06 | 4.5 | advisory |
| dark | ok / ok-soft | 7.00 | 4.5 | advisory |
| dark | bad / bad-soft | 6.55 | 4.5 | advisory |
| dark | warn / warn-soft | 7.23 | 4.5 | advisory |
| dark | accent / panel | 8.26 | 3 | advisory |

All pairs pass. The dark blocks agree.

## 6. Deviations from taste.md

- **A third face (JetBrains Mono)** for the card meta line. taste.md does not count a mono used for code, but here it also sets small data labels, a critic tell. It is kept because the approved cards facet (Stash) uses exactly this, and it doubles as the code face.
- **Zero radius, hairline rules.** These are the "broadsheet chrome" tell, but both approved references (aestudio rules, Stash cards) genuinely use them. Chips (999px) and code blocks (0.25rem) keep a radius, so the radii still follow hierarchy.
- **`.btn-primary` is filled, not a text link.** aestudio's CTAs are all text links, so a primary built the same way would not look different from a secondary one. The primary is therefore the only filled block on the page, square like the rest of the system.
- **Muted text** was darkened from Half the Sky's `#66645c` to meet the accessibility floor.

## 7. Critic outcome

**Pass 1: BLOCKED (1), 7 nits.**

Blocker, fixed:
1. The cards-from-stash facet was not visible because the standard preview never uses `.card-media` or `.card-meta`. `cards-preview-*.jpg` now show the Stash card form in both schemes and on hover. While doing this I also found and fixed a theme bug: the card CTA stretched to the full card width, fixed with `.card > .btn { align-self: flex-start }`.

Nits applied:
1. The accent was too close to ink: `#4d4636` → `#5a4a26`, and dark `#d3ccb8` → `#d9c79a`.
2. `.display` had no size of its own and now gets `clamp(3rem, 8vw, 6.5rem)`.
3. `--ease-out-quint` holds a real quint curve again, and components use `--ease-out`.
4. Dark `--color-line` `#3d3c36` → `#45443d`.
5. The cards preview uses slash-joined meta like aestudio's label, with no icon tiles and no numbered badge.

Nits left:
- **Middle-dot eyebrow and numbered badge in the standard preview.** They are in `preview.mjs`'s fixed copy, not in the theme.
- **Nav and footer facets not visible.** No contract class exists for them; see Known gaps.

**Pass 2 (fresh critic): PASS, 0 blocking issues, 8 nits.**

Nits applied:
1. `.btn` underline moved from `border-bottom` onto the text (`text-decoration`, offset 0.5em), as in aestudio.
2. `.prose th` is in sentence case; caps are now kept to the eyebrow and card meta only.
3. `overflow-wrap: anywhere` → `break-word` (with `hyphens: auto`) on headings, `.display`, `.card`, `.btn`, `.chip` and `.eyebrow`. `.prose a` keeps `anywhere` for long URLs.

The contract and contrast checks were re-run after these fixes; both exit 0.

Nits left:
- **Display size in the preview.** The preview's own `.tf-display` caps the h1 at 3.5rem, so the theme's `.display` ceiling of 6.5rem is not visible there.
- **Card hover crop.** The hover shot crops the thickened rule.
- **Dark card shot clipped on the right.** Both of these are scaffold limits of my card render.
- **Mono meta face.** Kept; see Deviations.
- **Middle dot and badge** in the fixed preview copy.

## 8. Known gaps

- The contract comes from the fixture, not the real sites theme.
- The new `.card-media`, `.card-meta` and `.card-title` classes do nothing until the sites' card markup uses them.
- There is no footer or pager component: aestudio's Previous / Page / Next bar would need a new class and markup.
- Bracketed `[ ← ] [ → ]` pagers from Stash were not part of approval B and were not added.
