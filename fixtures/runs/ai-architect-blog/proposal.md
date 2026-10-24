# AI architect blog + landing

| Field | Value |
| --- | --- |
| kind | editorial, landing |
| audience | CTOs and engineering leads evaluating an independent AI-architecture consultant |
| tone | calm, precise, warm |
| density | text-heavy |
| motion | 1 (subtle hover and fade) |
| dark_mode | both |
| must_have | prose, nav, card-system, buttons |
| mood | editorial, minimal, warm |
| languages | en, ru, es (Cyrillic required) |

All five candidates were quick-probed live on 2026-10-24.

## 1. GoShuin: Goshuin Map & Journal for iPhone (safe pick)

https://aestudio.studio/goshuin/en · [source](https://www.awwwards.com/sites/goshuin-every-stamp-a-memory)

**Why it fits.** This is the closest match to "calm, precise, warm". The page reads like a paged book: a Georgia serif title page, hairline bronze rules, and underlined text links instead of filled buttons. That is the low-hype register sceptical CTOs trust. The layout is airy and the motion is level 1, with a pause-motion control, so it fits the budget exactly. The paper `#f8f3e7` with slate ink `#2d3435` looks deliberately chosen rather than default cream, which suits long essays.

**What to take**
- type-pairing: serif display (Georgia → **Source Serif 4**, which has Cyrillic) over system sans (→ **Inter**, which has Cyrillic), with small tracked caps for metadata
- palette: paper `#f8f3e7`, slate ink `#2d3435`, bronze `#756449` for rules only
- buttons: underlined text links as the primary CTA style, a quiet way to say "get in touch"
- nav: a paging bar (Previous / select / Next), which can be adapted for essay pagination
- section-rhythm: hairline-ruled blocks with airy spacing

**What to leave:** the pixel-dithered Japanese pattern art, which belongs to this product, and the 129px display, which should be scaled down so long Russian words don't break.

## 2. Half the Sky

https://halfthesky.app/ · [source](https://www.cssdesignawards.com/sites/half-the-sky/50250)

**Why it fits.** It is both editorial and landing, with a stone-grey palette that is neutral but still warm. The nav is centred on one row and stays out of the way, which matches the "quiet top nav" requirement. A 4-up grid with hairline dividers works as a base for a calm article card system. Motion is level 1.

**What to take**
- card-system: a 4-up grid with hairline rules between tiles
- nav: a centred, one-row nav that stays out of the way
- palette: stone `#dddcd7` ground with warm grey `#3a3934` as the darkest tone

**What to leave:** tracked-out caps everywhere, and the `#66645c` on `#dddcd7` ink contrast, which fails the 7:1 floor. Darken the ink for prose.

## 3. The Quaker School at Horsham (bold pick)

https://www.quakerschool.org/ · [source](https://www.cssdesignawards.com/sites/the-quaker-school-at-horsham/50093)

**Why it fits.** A soft serif display paired with its own sans sibling for body text at 18.6px gives one family with two voices, which suits "precise but warm". The section gaps are very large (220–444px), so each block reads as a chapter, and the nav uses short plain labels. The palette is ivory `#f9f9f0` and near-black only.

**What to take**
- type-pairing: serif display + matching sans body (Season → **Newsreader** + **Inter**). Newsreader has no Cyrillic, so a Cyrillic-capable serif such as Source Serif 4 is needed for RU.
- section-rhythm: chapter-like vertical spacing (scale it down for article pages)
- nav: short plain-label links

**What to leave:** the full-bleed video hero and the 226px display. Motion is level 2, one above the budget, so keep only subtle transitions.

## 4. Stash

https://stash.cool/ · [source](https://www.awwwards.com/sites/stash)

**Why it fits.** It covers the most must-haves of any candidate: nav, card-system and buttons. It is a directory with real editorial structure: ruled section headers, bracketed `[ ← ]` pagers, mono meta lines and horizontal article cards. That is a strong model for a technical-essay index that already contains code blocks. Motion is level 1.

**What to take**
- card-system: horizontal article cards with a mono meta line (date · reading time · language)
- chips: tags for topics and languages
- buttons: bracketed pagers `[ ← ] [ → ]`
- nav: ruled section headers

**What to leave:** the giant slab wordmark, which is a logo and not a heading style. The `#8a8a8a` grey deks are below 4.5:1, and the highlighter yellow `#ffff00` should be dropped. Space Mono has no Cyrillic, so meta text needs a Cyrillic mono such as JetBrains Mono or IBM Plex Mono.

## 5. Farm Minerals

https://www.farmminerals.com/ · [source](https://www.cssdesignawards.com/wotm/farm-minerals/50091)

**Why it fits.** A two-colour system, bone `#f4ede6` and deep olive `#404f1d`, gives warmth without going cream-by-default. Every heading uses one regular-weight grotesk, and the outlined CTA with dot markers is a clear but calm contact action. The three-item nav keeps the page quiet.

**What to take**
- palette: a bone/olive duotone. It works well as a basis for dark mode, using bone-on-olive.
- buttons: an outlined CTA with dot markers, for the contact call to action
- type-pairing: a regular-weight grotesk (Aeonik → **Manrope**, which has Cyrillic)
- nav: a three-item nav with a centred logo

**What to leave:** the 3D product render hero, the uppercase Arial body and the GSAP ScrollTrigger reveals. Motion is level 2, above the budget.

## Combinations

- **A: #1 alone.** GoShuin as it is: a serif title page, paper and slate with bronze rules, text-link CTAs. The calmest option and the closest to the brief.
- **B: typography of #1 + palette of #2 + cards of #4.** Source Serif 4 / Inter over a warm stone ground, with Stash's ruled horizontal cards and mono meta. Editorial essays with a precise, technical index.
- **C: nav, buttons, type and rhythm of #1 + nav of #3.** GoShuin's book-like structure with Quaker's short plain-label top nav. The most restrained top bar of the three options.

## Next step

Reply with your choice, e.g. `approve B` or `approve 1, palette from 3`, then run `/tasteful:extract ai-architect-blog`.
