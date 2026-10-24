# Scripts — CLI contract

This is the shared contract every skill, test and script codes against. If a script's behaviour changes, change this file in the same commit.

All scripts live in `scripts/`, are Node ≥ 22 ESM (`.mjs`, no build step) unless noted, and are invoked from skills as:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs" … --data "${CLAUDE_PLUGIN_DATA}"
```

`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and `${user_config.KEY}` are substituted inline in skill/agent markdown only. They are **not** in the Bash environment, so skills always pass paths explicitly. Scripts resolve the data dir as `--data` → `$CLAUDE_PLUGIN_DATA` → `~/.claude/plugins/data/tasteful` (`scripts/lib/deps.mjs` → `dataDir()`).

## Common to all scripts

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--help`, `-h` | boolean | false | Print usage to stdout, exit 0 |
| `--json` | boolean | false | Print the result as JSON (or JSONL for streaming outputs) on stdout |
| `--data <dir>` | string | `$CLAUDE_PLUGIN_DATA` → `~/.claude/plugins/data/tasteful` | Plugin data dir holding `deps/` (npm deps) and, optionally, `browsers/` (Playwright) |

- **stdout carries only the result**: JSON with `--json`, otherwise a human-readable table. Some outputs ignore `--json` and are always machine-readable: crawlers and `probe --batch` emit JSONL, `index-edit diff` emits JSONL, `rank` and `fonts` always print JSON.
- **All logs, progress and warnings go to stderr** (`scripts/lib/log.mjs`, prefix `[tasteful]`; `TASTEFUL_DEBUG=1` enables debug lines).
- **Exit codes**: `0` success · `1` check failed / violation found · `2` usage or environment error (bad flags, unreadable input, Playwright unavailable where it is required).
- Flag forms: `--k v`, `--k=v`, `--no-<bool>`, repeated list flags (`--x a --x b`) or comma lists (`--x a,b`); `--` ends flag parsing.
- Network scripts send a real Chrome User-Agent string, never hang (every request has a timeout), and are polite (≤ 1 req/s per host unless stated).
- Default file paths (`index/sites.json`, `index/rejected.json`, `index/schema.json`, `index/taste.md`, `index/fonts.json`, `index/shots/`) resolve against the plugin root, whatever the cwd. Paths given explicitly on the command line resolve against the cwd.

## Shared data shapes

### Brief JSON

Written by the `find` skill to `${output_dir}/<slug>/brief.json`; consumed by `rank.mjs`. Examples in `fixtures/briefs/*.json`.

```jsonc
{
  "slug": "ai-architect-blog",          // kebab-case, used as the output folder name
  "title": "…",                         // human title
  "kind": ["editorial", "landing"],     // sites.json kind vocabulary
  "audience": "…",                      // one line
  "tone": ["calm", "precise", "warm"],  // 3 adjectives
  "density": "text-heavy",              // "text-heavy" | "balanced" | "visual"
  "motion": 1,                          // 0–3 budget (0 none · 1 subtle · 2 scroll-driven · 3 heavy/WebGL)
  "dark_mode": "both",                  // "both" | "light-first" | "dark-first"
  "must_have": ["prose", "nav"],        // components/extractables that must be covered
  "mood": ["editorial", "minimal"],     // sites.json mood vocabulary
  "languages": ["en", "ru", "es"]       // BCP-47 codes; "ru" ⇒ Cyrillic coverage required
}
```

### Candidate JSONL (all crawlers)

One object per line:

```json
{"url":"https://…","source":"awwwards","source_url":"https://…","score":7.4,"tags":["minimal"],"award":"sotd","date":"2026-10-01","title":"…"}
```

- `source` is one of `awwwards`, `cssda`, `behance`, `manual`.
- `score`, `award`, `date`, `title` may be `null` when the source does not provide them; `tags` is always an array (possibly empty).
- `tags` are lowercase slugs (`"Web & Interactive"` → `"web-interactive"`).
- `url` is canonical: lowercase host, no tracking params (`utm_*`, `fbclid`, `gclid`, `ref`), no `#…`, no trailing slash except on the root path (`https://example.com/` keeps its slash).
- Crawlers dedupe by host + path, ignoring the scheme and a leading `www.`.

### Polite fetching (crawlers)

`scripts/lib/fetch.mjs`: per-host token bucket at 1 req/s, 15 s timeout per request, redirects followed. A 403 or 429 waits 30 s (`TASTEFUL_BACKOFF_MS`) and retries; three consecutive 403/429 from one host stop the crawl (`stopped: blocked`). `robots.txt` is fetched once per origin and evaluated as `User-agent: *` (longest match wins, Allow wins ties); an unreachable `robots.txt` counts as allow-all.

---

## `probe.mjs`

`probe.mjs <url> [--quick] [--deep] [--out <dir>] [--timeout <ms>] [--batch <file>] [--concurrency <n>]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<url>` | string | — | Site to probe (required unless `--batch`); a bare host gets `https://` |
| `--quick` | boolean | false | Plain `fetch` liveness only (8 s cap): status, final_url, title, elapsed_ms. No browser. `mode: "quick"`. Mutually exclusive with `--deep` |
| `--deep` | boolean | false | Also write screenshots `desktop.jpg` (1440×900) and `mobile.jpg` (390×844), each ≤ 300 KB, into `--out` |
| `--out <dir>` | string | `index/shots/<host>` (plugin root) | Screenshot directory (created if missing); with `--batch`, shots go to `<out>/<host>/` |
| `--timeout <ms>` | number | 30000 | Per-page budget; the probe never hangs past it (a watchdog exits 1 if the whole run overruns) |
| `--batch <file>` | string | — | File of URLs, one per line, or JSONL objects with a `url` field (other fields are ignored; `#` lines skipped); emits one JSONL result per URL, each carrying its `url` |
| `--concurrency <n>` | number | 3 | Parallel pages in `--batch` mode |

Env: `TASTEFUL_FORCE_STATIC=1` skips the browser and forces the static fallback (used by tests).

Default mode (neither `--quick` nor `--deep`) is a browser probe of computed design facts: dismisses common cookie banners by text, waits for `document.fonts.ready`, scrolls through the first three viewports so lazy content settles, then samples up to 4000 visible elements. If Playwright is unavailable or the site blocks headless, falls back to fetch + HTML/CSS parsing with `mode: "static"` and `partial: true`.

**Blocked is never dead.** HTTP 403, 429 or 503, or a challenge page ("Just a moment", "Access denied", "Verify you are human", "Attention required") that does not clear within 4 s, switches to the static fallback and exits 0. Dead means HTTP ≥ 400 that is not a block, a network-level failure (DNS, refused, TLS, reset, timeout), or no response at all within the budget.

**Output** (JSON object with `--json`, otherwise a human key/value list; JSONL with `--batch`):

```jsonc
{
  "url", "final_url", "status", "mode": "browser|static|quick", "probed_at", "elapsed_ms",
  "title", "lang", "color_scheme": "light|dark",
  "sampled_elements": 0,                    // browser mode: elements sampled
  "fonts": { "loaded": [{"family","weight","style"}], "computed": { "body", "h1", "h2", "p", "nav", "button" },
             "faces": [], "google_fonts": false, "self_hosted": true },
  "type": { "h1": {"size","lineHeight","letterSpacing","weight","family"}, "h2": {…}, "body": {…} },
  "colors": {
    "backgrounds": [{"hex","area_pct"}],    // up to 8
    "texts": [{"hex","weight"}],            // up to 8; weight = 0–1 share of characters × font size
    "borders": [{"hex","count"}]            // up to 5
  },
  "radii": { "histogram": {"8px": 12} },
  "shadows": [{"value","count"}],           // up to 5
  "buttons": [{"text","bg","color","radius","padding","border","fontFamily","fontWeight","fontSize","height"}],  // up to 5 distinct
  "cards": [{"bg","border","radius","shadow","width","height"}],  // up to 5 distinct, 240–720 × 120–720 px
  "nav": { "height" }, "container": { "maxWidth" },
  "rhythm": { "section_gaps": [] },        // px, up to 10
  "motion": { "transition_durations": [], "easings": [], "animated_count", "canvas_count", "webgl",
              "libs": [],                   // any of gsap, ScrollTrigger, lenis, locomotive
              "level_guess": 0 },           // 0–3
  "cookie_banner_dismissed": false,
  "screenshots": { "desktop", "mobile" },   // paths, only with --deep (null when the site blocks headless)
  "partial": false,
  "errors": []
}
```

- `area_pct`: share of the sampled area, which is the viewport width × min(page height, 3 viewports). Each element's own background is counted where it differs from its parent's, and its area is subtracted from the parent, so shares do not double count and never sum past 100.
- `motion.webgl` is detected by intercepting `HTMLCanvasElement.getContext` (plus three.js globals or script URLs). Scroll libraries (gsap, ScrollTrigger, lenis, locomotive) raise `level_guess` to 2, never to 3; level 3 needs WebGL or an animated canvas.
- **Static mode** fills what CSS can tell: `fonts.computed` has only `body`, `type.*` are `null`, `backgrounds` carry `area_pct: null` plus a `count`, and two extra fields appear: `fonts.family_counts` (family → declarations, top 12) and `stylesheets: {inline, fetched}` (up to 5 same-origin stylesheets are fetched).

`--quick` output contains only `url, final_url, status, mode, probed_at, elapsed_ms, title, errors`.

Tidying (browser and static modes): any border-radius ≥ 1000px (Tailwind `rounded-full`, `9999px`, `3.35544e+07px`) is reported as `"pill"` in `radii.histogram`, `buttons[].radius` and `cards[].radius`; other px values are rounded to 2 decimals. Font names are cleaned (Next.js hashes such as `__Inter_d65c78`, Framer `:Weight` suffixes and `Placeholder` entries removed, Webflow concatenations like `Ppneuemontreal` recovered through `index/fonts.json` aliases); the untouched list is kept in `fonts.faces_raw`.

**Exit codes**: 0 probed (including static fallback for blocked sites); 1 site dead (JSON still printed) or the watchdog fired; 2 usage error (`--quick` with `--deep`, bad url, unreadable `--batch` file), or `--deep` requested without Playwright. In `--batch` mode exit 1 if any URL was dead.

---

## `contrast.mjs`

`contrast.mjs <theme.css> [--extended] [--suggest]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<theme.css>` | string | — | Theme file to check |
| `--extended` | boolean | false | Also report advisory pairs (never affect the exit code; skipped with a warning when a token is missing) |
| `--suggest` | boolean | false | For each failing pair, the nearest passing colour: same hue, lightness adjusted, **foreground only** |

Schemes: **light** = `@theme`; **dark** = `:root[data-theme="dark"]` (tokens not overridden there inherit from `@theme`). The `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` block must declare the same values as the data-theme block (`color-scheme` is ignored); any difference, or either dark block missing, is an error. `var(--x[, fallback])` references are resolved (up to 10 levels). Translucent colours are compared with alpha ignored (warning on stderr).

Required pairs (WCAG 2.x, both schemes):

| Foreground | Background | Minimum |
| --- | --- | --- |
| `--color-ink` | `--color-bg` | 7:1 |
| `--color-muted` | `--color-bg` | 4.5:1 |
| `--color-accent-ink` | `--color-accent` | 4.5:1 |
| `--color-accent` | `--color-bg` | 3:1 |

Advisory pairs (`--extended`): `ink/panel` 7:1, `muted/panel` 4.5:1, `ok/ok-soft` 4.5:1, `bad/bad-soft` 4.5:1, `warn/warn-soft` 4.5:1, `accent/panel` 3:1.

Pass/fail is decided on the unrounded ratio; `ratio` in the output is rounded to 2 decimals (so 6.996 shows as `7.00` and still fails 7:1).

**Output**: table `scheme | pair | ratio | min | pass`, then suggestions and errors, on stdout; with `--json`: `{file, ok, pairs:[{scheme, fg, bg, fg_hex, bg_hex, ratio, min, pass, required, suggest?: {hex, ratio} | null}], errors:[]}` (`suggest` is `null` when no lightness of the hue reaches the minimum).

**Exit codes**: 0 all required pairs pass and both dark blocks exist and agree; 1 any required violation, a missing dark block or a dark-block mismatch; 2 unreadable/unparseable file, a required token missing from `@theme`, or a required colour that cannot be resolved or parsed.

---

## `contract.mjs`

`contract.mjs <reference.css> <candidate.css> [--check]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<reference.css>` | string | — | Contract source (project `theme.css` or `fixtures/theme.reference.css`) |
| `<candidate.css>` | string | — | Generated theme to compare |
| `--check` | boolean | false | Exit 1 if anything is missing or any rule below is broken |

Checks, each reported as a finding with a clear message:

1. `@theme` tokens (`--font-*`, `--color-*`, `--radius-*`, `--shadow-*`, `--ease-*`) present in reference but missing in candidate. Each missing token gets a likely rename when possible: first a new candidate token with the same prefix **and** the same value, then the remaining new tokens matched 1:1 by prefix in order. A rename is still a missing token (it fails `--check`).
2. Classes defined in `@layer components` and `@layer base` of the reference but not defined anywhere in the candidate (any layer or top level counts).
3. `@utility` names missing.
4. Dark-selector coverage: every `--color-*` and `--shadow-*` token of the **candidate's own** `@theme` is overridden in both `:root[data-theme="dark"]` and the `prefers-color-scheme` fallback.
5. First-two-lines rule: the first two statements (ignoring comments and blank lines) are `@import "tailwindcss";` and `@source "../";` (single quotes accepted). A block statement is reported by its prelude, e.g. `@theme {`.
6. `!important` anywhere outside a `prefers-reduced-motion` block.
7. External `@import` (`http(s)://`, `//`, Google Fonts) — only bare package imports are allowed.

Additions (new tokens/classes) are listed as info, never failures.

**Output**: human list grouped by check (`ok` / `FAIL` per check); with `--json`: `{ok, missing:{tokens[], classes[], utilities[]}, renamed:[{from,to}], dark_missing:{data_theme[], media[]}, first_lines_ok, important:[{line,text}], external_imports:[], added:{tokens[], classes[]}}`.

**Exit codes**: 0 contract preserved (or without `--check`, always 0 if both files parsed); 1 with `--check` and any finding; 2 unreadable file or CSS parser error.

---

## `validate-index.mjs`

`validate-index.mjs [--index <path>] [--schema <path>] [--rejected <path>] [--live]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--index <path>` | string | `index/sites.json` (plugin root) | Index to validate |
| `--schema <path>` | string | `index/schema.json` (plugin root) | JSON Schema (draft 2020-12 subset, validated with the stdlib validator in `scripts/lib/schema.mjs`) |
| `--rejected <path>` | string | `index/rejected.json` (plugin root) | Rejected list to cross-check against; a missing file (warning) or an empty file such as `/dev/null` counts as `[]` |
| `--live` | boolean | false | Also run `probe.mjs --quick` on every entry not already `dead` (sequential, `--timeout 8000`, killed after 10 s) and report dead ones |

Checks: schema conformance, unique `id`, unique canonical `url`, entries with `status: "dead"` flagged, any url also present in `rejected.json`. Rejected entries may be `{url, reason, date}` objects or plain url strings.

URL comparison ignores the scheme (`http` = `https`), a leading `www.`, the `#fragment`, tracking params (`utm_*`, `gclid`, `fbclid`, `mc_cid`, `mc_eid`, `ref`, `ref_src`, `igshid`, `_ga`), query-param order and a trailing slash.

**Output**: table `id | rule | message` of violations then a summary line; with `--json`: `{ok, entries, violations:[{id, url, rule, message}], dead:[id], live_checked?: n}`. `rule` is one of `schema`, `unique-id`, `unique-url`, `rejected`, `dead`, `live`.

**Exit codes**: 0 valid; 1 any violation (dead entries are a violation); 2 unreadable file, invalid JSON or schema, or `probe.mjs` exiting 2 under `--live`.

---

## `crawl-awwwards.mjs`

`crawl-awwwards.mjs [--limit <n>] [--pages <n>] [--collections <list>] [--no-score]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--limit <n>` | number | none | Stop after n unique candidates |
| `--pages <n>` | number | 1 | Listing pages per collection |
| `--collections <list>` | list | `sotd,sotm,developer,minimal,typography,portfolio,e-commerce,clean,startup` | `sotd`, `sotm`, `developer`, or any tag collection slug (`/websites/<slug>/`) |
| `--no-score` | boolean | score on | Skip fetching each award page for its score (faster; `score: null`). The award page is still fetched when the listing card has no external link |

Polite fetching as above. Resolves award pages (`/sites/<slug>`, the `source_url`) to the external site URL; social and awwwards.com links are skipped.

- `award`: `sotm` \| `sotd` \| `developer` \| `honorable` \| `nominee` \| `null`; with several badges the first in that order wins.
- `score`: the award page's `box-score__note`, then `c-heading-score__note`, then a nearby `d.dd` number; kept only when 0–10.
- `date`: the award date from the card or the award page; `tags` from the listing card, else from the award page.

**Output**: candidate JSONL with `source: "awwwards"` on stdout; summary (pages fetched, award pages, candidates, duplicates, skipped by robots, no external link, errors, `stopped: done|limit|blocked`) on stderr.

**Exit codes**: 0 at least one candidate; 1 zero candidates (blocked or layout changed); 2 usage error.

---

## `crawl-cssda.mjs`

`crawl-cssda.mjs [--limit <n>] [--pages <n>] [--collections <list>] [--no-score]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--limit <n>` | number | none | Stop after n unique candidates |
| `--pages <n>` | number | 1 | Listing pages per collection |
| `--collections <list>` | list | `gallery,wotd,wotm` | CSS Design Awards collections (no others accepted) |
| `--no-score` | boolean | score on | Skip the award-page fetch (no vote scores, no tags); the listing's JPANEL score is used if present. The award page is still fetched when the card has no external link |

Same politeness rules as Awwwards. By default each award page is fetched; known duplicates are skipped before that fetch.

- `score`: mean of the UI, UX and Innovation vote scores on the award page (2 decimals), falling back to the listing's JPANEL score (WOTM award pages have no vote scores), else `null`.
- `award`: the listing card's category as a lowercase slug (e.g. `wotd`), else from the award page.
- `date`: from the award page (WOTM pages give only a month → day `01`), else the listing's month/day date with the current year, rolled back one year if that would be in the future.
- `tags`: lowercase slugs from the award page's TAGS line (`[]` with `--no-score`).
- `source_url`: the award page the card links to: `/sites/<slug>/<id>` (gallery, WOTD) or `/wotm/<slug>/<id>` (WOTM). A collection page that yields 0 cards logs a warning on stderr.

**Output**: candidate JSONL with `source: "cssda"`; summary on stderr (same counters as Awwwards).

**Exit codes**: 0 at least one candidate; 1 zero candidates; 2 usage error (including an unknown collection).

---

## `crawl-behance.mjs`

`crawl-behance.mjs [--limit <n>] [--max-minutes <n>]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--limit <n>` | number | none | Stop after n kept candidates |
| `--max-minutes <n>` | number | 15 | Hard wall-clock budget; the browser is closed and the script exits when it is reached |

Home feed only. Requires Playwright (bundled Chromium, falling back to the installed Chrome channel). Opens project pages at 1 page/s. Skips any URL disallowed by Behance's `robots.txt`, evaluated as `User-agent: *`. Keeps only projects whose page links an external website (the external site becomes `url`, the project page `source_url`): Behance redirect links (`?url=`, `?u=`, `?target=`) are unwrapped, nav/footer and social/Adobe links ignored. The site counts as live when it answers below 400, or with 403/429 (blocking bots is not death).

Candidates always have `score: null`, `tags: []`, `award: null`, `date: null`.

**Output**: candidate JSONL with `source: "behance"`; stderr summary including why it stopped (`done`, `budget`, `blocked`, `limit`).

**Exit codes**: 0 at least one candidate; 1 ran but kept zero candidates; 2 usage error, Playwright unavailable or Chromium failed to launch (reason on stderr).

---

## `rank.mjs`

`rank.mjs --brief <brief.json> [--index <path>] [--taste <path>] [--n <n>]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--brief <brief.json>` | string | — (required) | Brief JSON (shape above) |
| `--index <path>` | string | `index/sites.json` (plugin root) | Index to rank |
| `--taste <path>` | string | `index/taste.md` (plugin root) | Taste profile; weights are read from the ` ```json ` fence under `## Weights` (must contain `tag_overlap`, `taste`, `penalty`) |
| `--n <n>` | number | 5 | Number of candidates (skills pass `${user_config.max_candidates}`) |

Scores every `live` entry: tag overlap (kind, mood, extractable vs `must_have`), taste prefer/avoid matches, `anchor_bonus`, source score (`null` counts as 5), recency (full weight when `added` is within 365 days of today, half otherwise), penalties for motion above budget (per level), `tentative`, an `avoid` note naming a must-have, and a dark-first palette when the brief is not dark-first.

Diversity: only the best entry per `mood[0]` + `typography.display` combination is kept. With at least 4 eligible entries, one **safe** pick (highest taste match) and one **bold** pick (best entry outside the preferred moods, or exactly one motion level above the budget) are guaranteed a place. **Deterministic**: same inputs and same day, same output (ties broken by `id`).

`take` per candidate: the brief's `must_have`, then per brief kind (`landing`/`product`: hero, buttons · `editorial`/`docs`: type-pairing, section-rhythm, spacing-scale, chips · `tool`: buttons, chips, card-system, spacing-scale · `portfolio`/`studio`: type-pairing, hero, section-rhythm · `ecommerce`: card-system, buttons, nav), then `palette` — each only if the entry lists it in `extractable`. `leave` joins the entry's `avoid` note with a motion-over-budget line and a dark-first line, or says "nothing specific; take only what is listed".

**Output** (JSON on stdout regardless of `--json`, also on exit 1):

```jsonc
{
  "candidates": [{ "id", "score", "role": "safe|bold|null", "reasons": [], "take": [], "leave": "…" }],
  "combinations": [{ "label": "A", "parts": [{"id","take":[]}], "character": "…" }],  // A: top pick as-is; B: type + palette + cards/hero from three picks; C (or B): structure of one + colour of the bold pick
  "excluded": [{ "id", "reason" }]   // non-live entries and diversity duplicates
}
```

**Exit codes**: 0 ranked; 1 fewer than 3 eligible (live) entries; 2 unreadable brief/index/taste, index not an array, or missing/invalid weights fence.

---

## `index-edit.mjs`

`index-edit.mjs <command> [options] [--index <path>] [--rejected <path>] [--schema <path>]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<command>` | string | — | One of the commands below |
| `--index <path>` | string | `index/sites.json` (plugin root) | Index file (a missing file counts as `[]`) |
| `--rejected <path>` | string | `index/rejected.json` (plugin root) | Rejected list (a missing or empty file counts as `[]`) |
| `--schema <path>` | string | `index/schema.json` (plugin root) | JSON Schema every write is validated against |
| `--entry <file\|->` | string | — | `upsert`: entry JSON (object, array or JSONL) from a file or `-` for stdin |
| `--id <id>` | string | — | `set-status`: entry id |
| `--status <s>` | string | — | `set-status`: `live` \| `dead` \| `unchecked` (also sets `last_checked` to today) |
| `--url <u>` | string | — | `reject`: url to reject (removed from the index if present) |
| `--reason <text>` | string | — | `reject`: one-line reason |
| `--candidates <jsonl\|->` | string | — | `diff`: candidate JSONL file (or `-`) |
| `--from <glob>` | string | — | `merge`: glob of JSON/JSONL entry files; `*` and `?` match within one path segment |

Commands:

- `upsert --entry <json-file|->` — insert or replace by `id`; the url is canonicalised. A url already indexed under **another** id is a conflict: nothing is written, exit 1.
- `set-status --id <id> --status live|dead|unchecked`
- `reject --url <u> --reason <text>` — append `{url, reason, date}` to `rejected.json` (skipped if the url is already rejected) and remove matching entries from `sites.json`.
- `diff --candidates <jsonl|->` — print (JSONL) candidates whose url is in neither `sites.json` nor `rejected.json`, deduplicated within the input.
- `stats` — counts per source, kind, mood, status, plus entries, anchors, tentative, rejected.
- `merge --from <glob>` — upsert every entry found (a later file wins for the same id). Same-id entries that differ are `replaced`; entries whose url is indexed under another id are skipped and listed as `conflicts` (warning, not a failure).

Every write validates the whole index against the schema plus unique `id` and unique url (scheme and `www.` ignored) before writing. Writes are atomic (temp file + rename) and keep the file sorted by `id` with 2-space indentation.

**Output**: human summary; with `--json` a `{ok, changed, …}` object (`upsert`/`merge`: `inserted`, `replaced`, `unchanged`, plus `conflicts` and `files` for merge; validation failures: `errors`). `diff` always JSONL.

**Exit codes**: 0 done; 1 validation failed (nothing written), upsert conflict, or id not found; 2 usage error, unreadable input or schema, or no file matching `--from`.

---

## `preview.mjs`

`preview.mjs <theme.css> --out <dir> [--html-only]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<theme.css>` | string | — | Generated theme |
| `--out <dir>` | string | — (required) | Output directory (created if missing) |
| `--html-only` | boolean | false | Write `preview.html` only; skip screenshots (no Playwright needed) |

Writes `preview.html`: self-contained, no external requests. The theme is flattened to plain CSS (`@theme` → `:root`, `@layer` unwrapped, `@utility x` → `.x`, Tailwind at-rules dropped); `html` and `:root` rules also apply to `[data-theme]`, and the dark selectors are scoped to the panels, so light and dark render side by side. `@font-face` rules and declarations with an external `url()` are dropped (warning on stderr), so the font stacks fall back to installed families. Each panel has a hero with eyebrow/display/lead, `.btn` variants, chips, three `.card-link`, colour swatches for every `--color-*` token, a `.prose` block (with Cyrillic and Spanish lines) and the list of font stacks.

Then screenshots each panel (1280 px wide, full panel height up to 8000 px) to `preview-light.jpg` and `preview-dark.jpg`, each ≤ 300 KB; any network request is blocked.

**Output**: paths written (JSON with `--json`: `{html, light, dark}`; `light`/`dark` are `null` with `--html-only` or when screenshots failed).

**Exit codes**: 0 written; 1 theme could not be parsed or rendered; 2 usage error, or Playwright unavailable / Chromium failed to launch without `--html-only` (`preview.html` is still written).

---

## `fonts.mjs`

`fonts.mjs <family...> [--map <path>] [--verify]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<family...>` | string(s) | — | One or more observed font-family names |
| `--map <path>` | string | `index/fonts.json` (plugin root) | Proprietary → open-alternative map |
| `--verify` | boolean | false | Query the npm registry (and Fontsource `metadata.json` via jsDelivr when needed) at 1 req/s to confirm each package exists and read its subsets |

Matching normalises the name (quotes, Next.js hashed names like `__Inter_d65c78`, diacritics, case, camel case, numeric weights) and strips weight/width/style words (`Bold`, `Italic`, `Pro`, `Display`, `Condensed`, …) until a map entry matches.

**Output** (JSON array on stdout, regardless of `--json`):

```jsonc
[{ "observed": "GT America", "family": "Inter", "package": "@fontsource-variable/inter",
   "variable": true, "cyrillic": true, "latin_ext": true,
   "import": "@import \"@fontsource-variable/inter/wght.css\";",
   "alternative": true, "verified": null, "note": "…" }]
```

- `cyrillic` / `latin_ext` come from the map; `note` appears when the map entry has one; `alternative` is true when the observed face is not the package's own family.
- `verified` is `null` without `--verify`. With `--verify` it is a boolean, and each result adds `registry: {latest, subsets, variable_axes}` and, on failure, `problems: []` (package missing, subset mismatch with the map, no `wght` axis on a variable package, subsets unknown).
- Unmapped names give `{observed, family: null, package: null, …, error: "unmapped"}`.

Variable packages are preferred when several map entries match.

Matching order: exact alias → alias after stripping weight/width words and `:Weight` suffixes → alias compared with spaces and hyphens removed (`Ppneuemontreal`, `Atlasgrotesk Web`). A name that is empty after cleaning (e.g. `Placeholder`) is returned as `{ "observed", "skipped": "placeholder" }` and does not affect the exit code.

**Exit codes**: 0 every family mapped (and verified with `--verify`); 1 some family unmapped or failed verification; 2 usage error, unreadable map, or registry unreachable with `--verify`.

---

## `ensure-deps.sh`

`ensure-deps.sh <plugin-root> <data-dir> [--browsers] [--json]` (bash)

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<plugin-root>` | string | — | `${CLAUDE_PLUGIN_ROOT}` |
| `<data-dir>` | string | — | `${CLAUDE_PLUGIN_DATA}` |
| `--browsers` | boolean | false | Also make sure Playwright `chromium-headless-shell` launches (`--no-browsers` accepted) |
| `--json` | boolean | false | Print a JSON status object on stdout (otherwise a key/value list) |

Copies `scripts/package.json` + `package-lock.json` into `<data-dir>/deps` and runs `npm ci --omit=dev --ignore-scripts` there once, stamped by the lock-file hash (re-runs only when the lock changes or Playwright is missing). Never installs into the plugin root.

With `--browsers`, the browser is checked by actually launching it (20 s limit): a non-empty `<data-dir>/browsers` is tried first; otherwise Playwright's default cache is tried, and when that works nothing is installed and `<data-dir>/browsers` is not created. Only if both fail is `chromium-headless-shell` installed into `<data-dir>/browsers` and launched again; on failure the empty directory is removed.

**Output** (`--json`): `{"deps":"ok|installed|failed","browsers":"ok|installed|failed|skipped","fallback":null|"static","data":"…"}`.

**Exit codes**: 0 deps ready (browser failure still exits 0 and reports `fallback: "static"`); 1 `npm ci` failed (status still printed, `fallback: "static"`); 2 usage error, missing `package.json`/lock in the plugin root, or npm/node missing.

---

## `test.sh`

`bash scripts/test.sh` (bash, no flags; runs from the plugin root whatever the cwd)

Runs in order and stops on the first failure:

1. `claude plugin validate . --strict` (skipped with a notice when the `claude` CLI is not installed, e.g. in CI)
2. `node --test 'tests/**/*.test.mjs'` — the quoted glob is required: Node ≥ 22 (including Node 24) does not expand a bare directory argument such as `node --test tests/`
3. `node scripts/validate-index.mjs`
4. `node scripts/contrast.mjs fixtures/theme.reference.css`
5. `node scripts/contract.mjs fixtures/theme.reference.css fixtures/theme.reference.css --check`, then against `tests/fixtures/renamed-token.css` (one token renamed) — must exit 1 and mention `--color-ink`

To run only the unit tests: `node --test 'tests/**/*.test.mjs'`.

**Exit codes**: 0 all passed; 1 any check failed.
