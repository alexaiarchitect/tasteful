# The reference index

`index/sites.json` is a JSON array of reference-site entries, sorted by `id`. Its machine schema is `index/schema.json` (JSON Schema 2020-12 subset: only the keywords supported by the stdlib validator in `scripts/lib/schema.mjs`), enforced by `scripts/validate-index.mjs`, which also checks unique ids, unique canonical urls, dead entries and overlap with `index/rejected.json`. All writes go through `scripts/index-edit.mjs`, which validates before writing and writes atomically.

Every entry was probed live when it was added. Nothing is invented: tags come from probe facts first and from reading the screenshots second.

## Fields

| Field | Type | Allowed values / format | Required | How it is assigned |
| --- | --- | --- | --- | --- |
| `id` | string | kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`), ≤ 80 chars, unique | yes | From the site or studio name |
| `url` | string | format `uri`; by convention the canonical https url, no tracking params, no `#…` (`index-edit.mjs` canonicalises it); unique ignoring scheme, `www.`, fragment, tracking params and trailing slash | yes | The site itself, after redirects (`final_url`) |
| `title` | string | 1–200 chars | yes | The page `<title>`, trimmed of taglines |
| `source` | enum | `awwwards`, `cssda`, `behance`, `manual` | yes | Where it was found; anything added by hand without an award page is `manual` |
| `source_url` | string | format `uri` | yes | The award or project page; for `manual` without one, the url itself |
| `source_score` | number \| null | 0–10, or `null` | no | The source's own score when it publishes one, else `null` |
| `added` | date | `YYYY-MM-DD` | yes | Day the entry was written |
| `status` | enum | `live`, `dead`, `unchecked` | yes | From the last probe; `find` only ranks `live` |
| `last_checked` | date | `YYYY-MM-DD` | yes | Set by every `set-status` |
| `kind` | array | 1–3 unique of `landing`, `product`, `portfolio`, `editorial`, `ecommerce`, `tool`, `docs`, `studio` | yes | What the site is, from its content |
| `mood` | array | 1–3 unique of `minimal`, `editorial`, `brutalist`, `playful`, `luxury`, `technical`, `warm`, `corporate`, `retro`, `organic` | yes | Reading of the screenshots, checked against palette and type facts |
| `typography.display` | enum | `serif`, `sans`, `mono`, `display`, `mixed` | yes | Class of the computed `h1`/`h2` family |
| `typography.body` | enum | `serif`, `sans`, `mono` | yes | Class of the computed `body`/`p` family |
| `typography.faces` | array | 1–3 unique, non-empty family names | yes | `fonts.computed` and `fonts.loaded` from the probe, as observed |
| `typography.open_alternatives` | array | unique, non-empty Fontsource family names | no | `scripts/fonts.mjs` on the observed faces (variable and Cyrillic preferred) |
| `typography.note` | string | one line, 1–300 chars | no | What makes the pairing work |
| `color.strategy` | enum | `monochrome`, `accent-on-neutral`, `duotone`, `vivid`, `dark-first`, `warm-neutral`, `cold-neutral` | yes | From `colors.backgrounds` by area and the number of saturated hues |
| `color.dominant` | hex | lowercase `#rrggbb` | yes | Largest background by `area_pct` |
| `color.accent` | hex | lowercase `#rrggbb` | yes | Most-used saturated colour on buttons/links |
| `color.ink` | hex | lowercase `#rrggbb` | yes | Heaviest text colour by `weight` |
| `color.note` | string | one line, 1–300 chars | no | |
| `layout.grid` | enum | `single-column`, `12-col`, `asymmetric`, `bento`, `full-bleed` | yes | Screenshots plus `container.maxWidth` |
| `layout.density` | enum | `airy`, `balanced`, `dense` | yes | `rhythm.section_gaps` and screenshots |
| `layout.hero` | enum | `type-only`, `image`, `video`, `product-shot`, `split`, `wash` | yes | The desktop screenshot's first viewport |
| `layout.note` | string | one line, 1–300 chars | no | |
| `motion` | integer | 0 none · 1 subtle hover/fade · 2 scroll-driven · 3 heavy/WebGL | yes | `motion.level_guess`, corrected by `canvas_count`, `webgl` and the transitions seen |
| `extractable` | array | 1–8 unique of `type-pairing`, `palette`, `card-system`, `hero`, `section-rhythm`, `nav`, `footer`, `buttons`, `chips`, `motion`, `spacing-scale` | yes | What is distinctive *and* reusable in a token/class theme |
| `why` | string | 10–600 chars | yes | One or two concrete sentences: why it is in the index |
| `avoid` | string | 1–300 chars | no | What not to copy; also set by `/tasteful:rate <id> -` |
| `anchor` | boolean | | no | `true` for the taste-anchor entries that define the upper bar; `rank.mjs` adds `anchor_bonus` |
| `tentative` | boolean | | no | `true` when it is unclear the entry passes the taste profile; `rank.mjs` subtracts `penalty.tentative` |
| `screenshots` | object | `{ desktop?, mobile? }` non-empty path strings, no other keys | no | Written by `probe.mjs --deep` (1440×900 and 390×844 JPEG, ≤ 300 KB) under `index/shots/<id>/` (gitignored) |
| `probe` | string | `index/probes/<id>.json` (pattern `^index/probes/<kebab-id>\.json$`) | no | The stored probe result the tags were derived from; `extract` reuses it when fresh |

The objects `typography` (required: `display`, `body`, `faces`), `color` (required: `strategy`, `dominant`, `accent`, `ink`) and `layout` (required: `grid`, `density`, `hero`) are themselves required; their `note` is optional.

No other fields are allowed (`additionalProperties: false` on the entry and on `typography`, `color`, `layout` and `screenshots`).

The vocabularies and shapes live under `$defs` in `index/schema.json`, so tools and other schemas can reference them: `source`, `status`, `kind`, `mood`, `extractable`, `typography_display`, `typography_body`, `color_strategy`, `layout_grid`, `layout_density`, `layout_hero`, `motion` (enums and the 0–3 integer), `id`, `date`, `url`, `hex`, `line` (formats), and `typography`, `color`, `layout`, `screenshots`, `entry` (objects).

## How tags are assigned

1. `probe.mjs` (default or `--deep`) records computed facts: font families per element, type scale, background and text colours by area, radii, shadows, section gaps, container width, transitions, canvas/WebGL.
2. Facts decide the factual fields (`faces`, `display`/`body` class, `dominant`/`accent`/`ink`, `motion`).
3. The desktop and mobile screenshots decide the judgement fields (`mood`, `grid`, `hero`, `density`, `extractable`), never against a fact.
4. The taste profile (`index/taste.md`) is the final filter; borderline entries get `tentative: true`.

Drop rules (recorded in `rejected.json` instead of indexed): the site is dead; it is a template demo; it is an agency selling templates; it is a pure WebGL showpiece with no reusable system; it clearly conflicts with the Dislikes in `taste.md`.

## `rejected.json`

A JSON array of `{ "url", "reason", "date" }` (plain url strings are also accepted by `validate-index.mjs`; a missing or empty file counts as `[]`), appended by `index-edit.mjs reject --url <u> --reason <text>` (which also removes the url from `sites.json` if present). Its role is memory: `index-edit.mjs diff` drops every rejected url from crawler output, so `/tasteful:refresh` never proposes it again, and `validate-index.mjs` fails if a url is in both files. To give a site a second chance, delete its line and run `/tasteful:add <url>`.

## Behance

Verified facts:

- Plain HTTP fetches of `behance.net` pages get **403**.
- Behance's `robots.txt` **disallows Claude user agents**, and disallows `/search/*?field=*` for **all** agents, so the Product Design category (`/search/projects?field=product%20design`) is off limits to any crawler.
- `scripts/crawl-behance.mjs` therefore only tries the **home feed** with Playwright, skips anything `robots.txt` disallows, keeps only projects that link a live external site, and stops at its time budget. It is best effort and may legitimately return nothing.

The supported path is **assisted mode**: `/tasteful:add behance`. With Claude in Chrome available, it opens behance.net in a tab in your own browser, you click projects you like and say "next", and it reads only those project pages to find the external site, probes that site and proposes an entry (`source: "behance"`, `source_url` = the project page). Without the browser tools, paste project urls (and the live-site links) and it proceeds from those.

## Sources

Mirrors `index/sources.json`, which is where sources are configured. Template marketplaces are excluded.

| Source id | Role | Entry points | Crawler | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `awwwards` | primary, juried; award pages carry a jury score (0–10), award type and tags | https://www.awwwards.com/websites/ — Sites of the Day, Sites of the Month, Developer Award, and the `minimal`, `typography`, `portfolio`, `e-commerce`, `editorial`, `startup` listings | `crawl-awwwards.mjs` | active | Listings are plain HTML; the award page `/sites/<slug>` carries the score. `robots.txt` disallows `/tag/`, `/gallery/`, search and query strings on the root listing; collection pages and award pages are allowed |
| `cssda` | primary, juried; UI / UX / Innovation scores (0–10) | https://www.cssdesignawards.com/ — website gallery, WOTD and WOTM winners | `crawl-cssda.mjs` | active | Score = mean of the three vote scores on the award page, falling back to the listing's JPANEL score. `robots.txt` only disallows DotBot |
| `behance` | volume source, noisy; only projects linking a live external site are kept | https://www.behance.net/ (home feed only) | `crawl-behance.mjs` | assisted | See Behance above; `/tasteful:add behance` is the supported path |
| `manual` | anything added with `/tasteful:add` | — | none | active | The user supplies the url; `probe.mjs` fetches only that site |

Taste-anchor entries (the studio portfolio that sets the upper bar) are not a feed: they are added by hand with `/tasteful:add <url> [source-url] --anchor`, keep their real `source` (usually `manual`), and carry `anchor: true`.

To add a source: add an object to `index/sources.json` (id, role, entry url, collections, politeness notes), add its id to the `source` enum in `index/schema.json`, write a `scripts/crawl-<id>.mjs` that emits the candidate JSONL of `docs/SCRIPTS.md` at 1 req/s with a real User-Agent and `robots.txt` respected, document it in `docs/SCRIPTS.md`, and add a row here.

## Seeding log

Seeded on **2026-10-24**. Working files stay in `index/staging/` (gitignored); `index/staging/SEEDING-LOG.md` has the full command log.

**Sources crawled.**

- Awwwards: `sotd`, `sotm`, `minimal`, `typography`, `portfolio` and `editorial`, page 1 each. `editorial` turned out to be the tag "Websites using editorial font" (2 sites), not an editorial category, so `clean` was crawled afterwards as an extra collection.
- CSSDA: website gallery pages 1–2, WOTD pages 1–2 and WOTM. WOTM returned 0 cards on the first run because `parseListing()` only accepted `/sites/...` hrefs while WOTM cards link to `/wotm/...`; it was crawled again as an extra (18 cards).
- Behance: the home feed via Playwright (`--limit 15 --max-minutes 10`). 35 project links were opened, 24 had no website link and 3 linked a dead site, leaving 8 candidates.

**Candidates.** 213 crawled (awwwards 133, cssda 72, behance 8), 208 unique after deduping by registrable domain, then 185 live, 22 unreachable from this network and 1 dead. The 22 all sit behind the same Cloudflare addresses and time out at TCP connect from this machine, including known-live sites, so they are recorded as a network block, not as dead. The dead one is virugroup.com (an https→http redirect to a refused port). The extra `clean` and `wotm` crawls added 49 candidates; 25 were new hosts and 24 of those were live.

**Probes and tagging.** 96 sites were deep-probed: the 80-entry shortlist (quotas of 40 awwwards and 20 cssda plus all behance, filled by rank) and a second shortlist of 16 from the extra crawl. Three independent taggers each took one batch and tagged it with `index/staging/TAGGING-RUBRIC.md`, reading the probe JSON and then checking both screenshots before writing any tag.

**Result.** 56 kept: 24 firm and 32 `tentative`. 41 rejected, each with a reason in `rejected.json`.

| Source | Kept | Rejected |
| --- | --- | --- |
| awwwards | 33 | 17 |
| cssda | 19 | 20 |
| behance | 4 | 4 |
| total | 56 | 41 |

Kept entries by kind (an entry can have several): portfolio 20, studio 19, landing 18, editorial 9, product 8, ecommerce 5, tool 3, docs 1. By mood: minimal 30, editorial 25, technical 11, warm 11, playful 10, luxury 9, brutalist 7, corporate 7, organic 4, retro 1. All 56 are `status: "live"`.

The most common reasons for rejection were WebGL experiences and preloader-only captures with no readable system (9 rejections cite a loader), "browser not supported" pages (3; the crawler had stored the `/unsupported` redirect target as the url), template agency or SaaS looks, generic 3D renders, blank or dead renders, a Webflow template demo and a marketplace shop.

**Anchors.** No studio "anchor" source was seeded, so no entry has `anchor: true`. The juries reward what they reward, and that is not the same as this profile's taste. The `anchor` flag exists so that the user can pin, by hand, the few sites that define the quality ceiling (`/tasteful:add <url> --anchor`), and `rank.mjs` gives them `anchor_bonus`. Until then, the Upper bar in `index/taste.md` lists the strongest juried entries instead.

**Probe limitations seen during seeding.**

- Preloader screenshots: several sites showed only a loader at capture time, so their colour and type facts describe the loader. Waiting longer before the screenshot would rescue some of them.
- Background area skew: video heroes and stacked full-viewport layers distort `colors.backgrounds` area percentages (white or black splits that do not match the render), and text weight can pick white text over video as ink.
- Hashed or obfuscated font names (Next.js `__bodyFont_…`, Shopify aliases, `ctfp`-style names), plus Webflow lowercased and `PP`-prefixed names that `fonts.mjs` did not map. Taggers resolved these by hand.
- The WebGL flag fires on static, readable pages (for example a news front with one embedded video), which overstates `motion.level_guess`.
- Radii overflow: Tailwind `rounded-full` came back as `3.35544e+07px`.

Pill radii normalisation and font-name cleaning (prefix, spacing and case handling) were fixed in the scripts afterwards.

**Follow-ups.**

- Run `/tasteful:refresh` over the longlist: 105 live candidates have not been probed yet.
- Re-probe the 22 unreachable hosts from a different network.
- Run an assisted Behance session (`/tasteful:add behance`), since the automated home-feed crawl yields little.
