# DJI Osmo Pocket settings guide

| Field | Value |
| --- | --- |
| kind | docs, tool |
| audience | Hobbyist creators looking up camera settings quickly, often on a phone while shooting |
| tone | technical, direct, trustworthy |
| density | text-heavy (compact tables, spec lists, short how-to steps) |
| motion | 0 |
| dark_mode | both |
| must_have | nav, chips, spacing-scale (compact tables have no extractable tag; they shape density) |
| mood | technical, minimal |
| languages | en |

Caveat: the index has only 1 docs and 3 tool entries, and every candidate below is at motion 1–2, over the budget of 0. Take their tokens, not their transitions.

## 1. Stash — https://stash.cool/ — [source](https://www.awwwards.com/sites/stash)

**Why it fits this brief.** It is the only candidate that is already a dense reference tool: a directory with ruled section headers, bracketed `[ ← ]` pagers and Space Mono meta lines. That is the right grammar for settings values (resolution, fps, shutter, ISO) shown as mono chips. Black and white with one highlighter yellow `#ffff00` gives you a single accent you can use for the recommended value. The balanced 12-col density suits comparison tables.

**What to take**
- chips: mono meta lines (Space Mono) as the model for settings-value chips
- nav: ruled section headers with bracketed pagers, which scan well across many sections
- card-system: horizontal article cards with a mono title and a Helvetica dek, for scenario cards
- buttons: the black-and-white control style with yellow kept for one state

**What to leave.** The full-width slab wordmark, which is a logo, not a heading style. Also the grey `#8a8a8a` deks, which fall below 4.5:1 and would fail outdoors in sunlight.

## 2. GoShuin (AE Studio) — https://aestudio.studio/goshuin/en — [source](https://www.awwwards.com/sites/goshuin-every-stamp-a-memory)

**Why it fits this brief.** Its trust comes from restraint: hairline bronze `#756449` rules, underlined text links in place of filled buttons, and a pause-motion control. Its paging bar (Previous / page select / Next) is a ready pattern for stepping through scenarios on a phone. System sans for UI and small tracked caps for metadata work well for table headers. It ranks high mostly on your taste profile (serif, warm-neutral), and the brief asks for technical, not editorial.

**What to take**
- nav: the Previous / select / Next paging bar, for jumping between scenarios one-handed
- section-rhythm: hairline-ruled sections
- buttons: underlined text links instead of filled buttons
- palette: slate ink `#2d3435` on paper `#f8f3e7` with bronze rules, a good base for the light scheme

**What to leave.** The 129px Georgia display, the book-spread split hero and the dithered pattern art. All three are too editorial and too airy for a dense lookup page.

## 3. 一卦 (Yi Gua) — https://yigua.art/?lang=en — [source](https://www.cssdesignawards.com/sites/yi-gua/50511)

**Why it fits this brief.** A single-purpose tool built entirely from system fonts (`ui-serif` over `ui-sans-serif`, zero webfonts). That loads instantly on a phone in the field. Its hairline-framed header and footer and its single black pill show how one primary action (Show settings) can carry a picker.

**What to take**
- spacing-scale: the calm vertical steps between headline, subtitle and action
- buttons: one black pill as the only primary action
- palette: near-black `#171815` on warm paper `#f3f0e8`, with `#65645e` for secondary text

**What to leave.** The soft radial glow and the motion level 2, both over budget. The airy single-column centring also does not fit table-heavy pages.

## 4. Enric Badrinas — https://enricbadrinas.com/ — [source](https://www.behance.net/gallery/180444857/La-Deseada)

**Why it fits this brief.** It shows strict economy: one grotesk at one size (16px), a two-link nav and pure black on white. That suits direct, no-ornament settings pages, and the monochrome base is the easiest to invert cleanly for the dark scheme.

**What to take**
- nav: a minimal top-right link nav, useful as the compact header above a longer section index
- spacing-scale: a disciplined single-size system where hierarchy comes from spacing, not type size

**What to leave.** The photo-led hero and the one-size type. Dense tables need at least a second size and weight.

## 5. ALMADA LABEL — https://almadalabel.com/ — [source](https://www.awwwards.com/sites/almada-label)

**Why it fits this brief.** A plain grotesk UI with an ink-filled square button and no chromatic accent, so it reads as neutral and trustworthy. It is the weakest fit (fashion e-commerce) and is mainly useful as a button and nav reference.

**What to take**
- buttons: an ink-filled square primary button using `#17140f`
- nav: a short plain nav split on both sides

**What to leave.** The full-bleed photo hero, the italic serif collection labels and the spaced wordmark. The font names are Shopify aliases, so the real faces are unknown.

## Combinations

- **A: #2 alone.** GoShuin as-is: hairline rules, text-link buttons and paper/slate tones. Calm and trustworthy, but more editorial than technical.
- **B: typography of #2 + palette of #3 + cards of #1.** A system-sans UI with tracked-caps metadata over warm paper and near-black ink, with Stash's horizontal mono-titled cards for scenarios. A quiet reference look with structured, dense cards.
- **C: nav, type pairing, section rhythm and buttons of #2 + nav of #1.** GoShuin's paging bar and hairline rules, plus Stash's ruled section headers and bracketed pagers for the many-section index. The most navigable option.

Recommendation for this brief: start from **#1 Stash** for chips, nav and cards, and take the light palette from #2 or #3. For example: `approve 1, palette from 3`.

## Next step

Reply with your choice, e.g. `approve B` or `approve 1, palette from 3`, then run `/tasteful:extract dji-settings-guide`.
