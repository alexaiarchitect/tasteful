# Taste profile

Baseline is the current `theme.css`: a neutral warm-grey light scheme, Inter body with Source Serif 4 display, one blue accent, a 1rem card radius, soft layered shadows, `ease-out-quint`, and restrained motion. Every rule below is measured against that baseline; a reference earns its place by doing something better than it, not by being different.

## Likes

- An editorial serif display with a quiet sans body; the contrast between the two carries the personality.
- One accent, used sparingly: links, the primary button and focus, nothing decorative.
- Generous whitespace with a strong type scale; hierarchy comes from size and weight, not boxes.
- Sections that read as a sequence, not a stack of cards; rhythm set by consistent vertical gaps.
- Long-form text that is comfortable to read: 60–75 characters per line, body line-height around 1.6, real tables and code blocks.
- Radii and shadows that follow hierarchy: a page surface, a card and a chip do not all share one radius.
- Neutrals with a slight temperature (warm or cold grey) instead of pure greys.
- Motion that answers an action (hover, open, confirm) and is over in under 300 ms.
- A dark scheme designed as a peer of the light one, not an inverted afterthought.
- Navigation that stays quiet: short, plain labels, one row, no mega-menu.
- A light or book-weight serif display (about 220–400) at large sizes over a plain grotesk body; the weight contrast does the work, not colour.
- A dark chromatic ink instead of black: navy `#1e305e` or olive `#373f1d` on a warm white or stone surface.
- Section spacing on a few large, distinct steps (24 / 40 / 120 / 240px) so the page reads as a slow sequence.

## Dislikes

- The template-looking SaaS hero with three feature cards underneath.
- Gradient blobs, glows and mesh washes used as decoration.
- More than two typefaces (a monospace for code does not count).
- Motion that blocks reading: scroll-jacking, pinned sections, text that animates in word by word.
- Stock illustration and generic 3D renders.
- Dark-mode-only sites, or a light scheme that is clearly derived as an afterthought.
- Content chopped into identical rounded cards with the same grey shadow under each.
- A tracked-out all-caps label above every heading; one highlighted word in every headline.
- Numbered 01 / 02 / 03 markers on content that is not a sequence.
- A warm cream background with a terracotta accent as a default rather than a choice.
- A `→` appended to every link and button.
- A preloader or intro animation that gates the content; if the first screen is a loader, there is nothing to learn from it.
- "Browser not supported" or WebGL-only gates that show no page at all without a specific setup.

## Non-negotiables

- **Accessibility floor**, in both schemes, computed with `scripts/contrast.mjs`: `--color-ink` on `--color-bg` ≥ 7:1, `--color-muted` on `--color-bg` ≥ 4.5:1, `--color-accent-ink` on `--color-accent` ≥ 4.5:1, `--color-accent` on `--color-bg` ≥ 3:1. The sites CI runs Lighthouse with accessibility ≥ 95.
- **Self-hosted fonts** via `@fontsource-variable/*` (preferred) or `@fontsource/*`. No Google Fonts links, no external CSS.
- **Trilingual sites (EN / RU / ES)**: every face needs Cyrillic coverage, and headings, buttons, chips and cards must survive long Russian and Spanish words without overflowing (`overflow-wrap`, `hyphens`, no fixed-width labels).
- **Dark mode is mandatory**, through `:root[data-theme="dark"]` and the `prefers-color-scheme` fallback, with every colour and shadow token overridden.
- **Keep `prefers-reduced-motion`** handling; motion level 0 means no transitions beyond colour.

## Upper bar

The bar is set by the strongest juried entries in `index/sites.json`; no entry carries `anchor: true` yet, and `/tasteful:add <url> --anchor` promotes a site to an explicit anchor. A candidate that does not stand next to these comfortably does not enter the index.

- **runtimewire** — https://runtimewire.com/ — Newsreader headlines over Inter UI on cool grey `#f9fafb` with blue-black ink and one burnt-orange `#bb4d00` kicker, plus a designed light/dark/terminal theme switch, all on open faces.
- **terakawaoffice** — https://www.terakawaoffice.com/en — EB Garamond for headings and body at about 1.8 leading on warm off-white `#fbfaf7`, with a single bronze `#6d5a33` for italics, rules and outline buttons, so long copy reads like a book.
- **tengilemalamala** — https://tengilemalamala.com/ — a 220-weight serif display at 120px over plain Inter, olive `#5c6e21` as both accent and link with dark-olive ink and no black, and section gaps stepping 100 to 196px.
- **odysseeclinic** — https://www.odysseeclinic.com.au/ — navy `#1e305e` replaces black as ink on warm white `#fffcf8`, a light serif pairs with small grotesk caps, and spacing runs on a clear 24/40/120/240 scale.
- **aestudio** — https://aestudio.studio/goshuin/en — an app landing set as a paged book: Georgia title page, hairline bronze rules on paper `#f8f3e7`, underlined text links instead of filled buttons, and a pause-motion control.
- **zenarate** — https://www.zenarate.com/ — a book-weight variable serif at 64/48px over a medium Manrope body, `#d0d0ce` hairlines and 16px cards, with its only colour (butter `#fde173`) kept to the logo tile.
- **estudioniksen** — https://estudioniksen.com/ — one grotesk (Neue Montreal, 42px headings, 16/24 body) in black on light grey `#f0f0f0`, 2px radii and a one-row nav, letting the photography carry all the colour.
- **aat-architecten** — https://www.aat-architecten.be/ — a single grotesk at two sizes (40px statement, 16px body), warm black `#1d1d1b` on white with grey `#ababab` nav, and a statement-plus-photo split that stacks cleanly on mobile.

## Weights

Read by `scripts/rank.mjs` (the JSON fence below is parsed; keep it valid). `tag_overlap` weights each matching brief tag, `taste.prefer` / `taste.avoid` add or subtract `taste.match` per matching field, `anchor_bonus` is added to anchor entries, `source_score` multiplies the source's own score, `recency` favours recently added entries, and each `penalty` is subtracted when its condition holds.

```json
{
  "tag_overlap": { "kind": 3, "mood": 2, "extractable": 1 },
  "taste": { "match": 2, "prefer": { "mood": ["minimal", "editorial", "warm", "technical"], "typography.display": ["serif", "mixed"], "color.strategy": ["accent-on-neutral", "warm-neutral", "cold-neutral"], "layout.density": ["airy", "balanced"] }, "avoid": { "mood": ["corporate", "retro"], "color.strategy": ["vivid"], "layout.hero": ["video"] } },
  "anchor_bonus": 3,
  "source_score": 0.5,
  "recency": 1,
  "penalty": { "avoid_conflict": 2, "motion_over_budget": 3, "tentative": 1, "dark_only_when_light_needed": 2 }
}
```

## Feedback log

Appended by `/tasteful:rate` as `- YYYY-MM-DD · <id> · + / − · note`. Three consistent signals become a proposed rule above.

- (no feedback yet)
