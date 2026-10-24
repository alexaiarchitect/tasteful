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
| `--data <dir>` | string | `$CLAUDE_PLUGIN_DATA` → `~/.claude/plugins/data/tasteful` | Plugin data dir holding `deps/` (npm deps) and `browsers/` (Playwright) |

- **stdout carries only the result**: JSON with `--json`, otherwise a human-readable table. Crawlers and `probe --batch` always emit JSONL.
- **All logs, progress and warnings go to stderr** (`scripts/lib/log.mjs`, prefix `[tasteful]`; `TASTEFUL_DEBUG=1` enables debug lines).
- **Exit codes**: `0` success · `1` check failed / violation found · `2` usage or environment error (bad flags, unreadable input, Playwright unavailable where it is required).
- Flag forms: `--k v`, `--k=v`, `--no-<bool>`, repeated list flags (`--x a --x b`) or comma lists (`--x a,b`).
- Network scripts send a real User-Agent string, never hang (every request has a timeout), and are polite (≤ 1 req/s per host unless stated).
- Default file paths are relative to the plugin root (`index/sites.json`, `index/rejected.json`, `index/schema.json`, `index/taste.md`, `index/fonts.json`).

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

`source` is one of `awwwards`, `cssda`, `behance`, `manual`. `score`, `award`, `date`, `title` may be `null` when the source does not provide them. `url` is canonical (no tracking params, no trailing `#…`).

---

## `probe.mjs`

`probe.mjs <url> [--quick] [--deep] [--out <dir>] [--timeout <ms>] [--batch <file>] [--concurrency <n>]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<url>` | string | — | Site to probe (required unless `--batch`) |
| `--quick` | boolean | false | Plain `fetch` liveness only: status, final_url, title, elapsed_ms. No browser. `mode: "quick"` |
| `--deep` | boolean | false | Also write screenshots `desktop.jpg` (1440×900) and `mobile.jpg` (390×844), each ≤ 300 KB, into `--out` |
| `--out <dir>` | string | `index/shots/<host>` | Screenshot directory (created if missing) |
| `--timeout <ms>` | number | 30000 | Per-page budget; the probe never hangs past it |
| `--batch <file>` | string | — | File of URLs, one per line or JSONL with a `url` field; emits one JSONL result per URL |
| `--concurrency <n>` | number | 3 | Parallel pages in `--batch` mode |

Default mode (neither `--quick` nor `--deep`) is a browser probe of computed design facts: dismisses common cookie banners by text, waits for `document.fonts.ready`. If Playwright is unavailable or the site blocks headless, falls back to fetch + HTML/CSS parsing with `mode: "static"` (and `partial: true` where facts are missing).

**Output** (JSON object; JSONL with `--batch`):

```jsonc
{
  "url", "final_url", "status", "mode": "browser|static|quick", "probed_at", "elapsed_ms",
  "title", "lang", "color_scheme",
  "fonts": { "loaded": [], "computed": { "body", "h1", "h2", "p", "nav", "button" }, "faces": [], "google_fonts": false, "self_hosted": true },
  "type": { "h1": {"size","lineHeight","letterSpacing","weight"}, "h2": {…}, "body": {…} },
  "colors": { "backgrounds": [{"hex","area_pct"}], "texts": [{"hex","weight"}], "borders": [] },
  "radii": { "histogram": {} },
  "shadows": [], "buttons": [], "cards": [],
  "nav": { "height" }, "container": { "maxWidth" },
  "rhythm": { "section_gaps": [] },
  "motion": { "transition_durations": [], "easings": [], "animated_count", "canvas_count", "webgl", "level_guess" },
  "cookie_banner_dismissed": false,
  "screenshots": { "desktop", "mobile" },   // paths, only with --deep
  "partial": false,
  "errors": []
}
```

`--quick` output contains only `url, final_url, status, mode, probed_at, elapsed_ms, title, errors`.

**Exit codes**: 0 probed (including static fallback); 1 site dead/unreachable (status ≥ 400 or network error — JSON still printed); 2 usage error, or `--deep` requested without Playwright. In `--batch` mode exit 1 if any URL was dead.

---

## `contrast.mjs`

`contrast.mjs <theme.css> [--extended] [--suggest]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<theme.css>` | string | — | Theme file to check |
| `--extended` | boolean | false | Also report advisory pairs: ink/panel, muted/panel, ok/ok-soft, bad/bad-soft, warn/warn-soft, accent/panel (never affect exit code) |
| `--suggest` | boolean | false | For each failing pair, print the nearest passing colour (same hue, adjusted lightness) |

Schemes: **light** = `@theme`; **dark** = `:root[data-theme="dark"]` (tokens not overridden there inherit from `@theme`). The `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` block must declare the same values as the data-theme block; any difference is an error.

Required pairs (WCAG 2.x, both schemes):

| Foreground | Background | Minimum |
| --- | --- | --- |
| `--color-ink` | `--color-bg` | 7:1 |
| `--color-muted` | `--color-bg` | 4.5:1 |
| `--color-accent-ink` | `--color-accent` | 4.5:1 |
| `--color-accent` | `--color-bg` | 3:1 |

**Output**: table `scheme | pair | ratio | min | pass` on stdout; with `--json`: `{file, ok, pairs:[{scheme, fg, bg, fg_hex, bg_hex, ratio, min, pass, required, suggest?}], errors:[]}`.

**Exit codes**: 0 all required pairs pass and dark blocks agree; 1 any required violation or dark-block mismatch; 2 unreadable/unparseable file or a required token missing.

---

## `contract.mjs`

`contract.mjs <reference.css> <candidate.css> [--check]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<reference.css>` | string | — | Contract source (project `theme.css` or `fixtures/theme.reference.css`) |
| `<candidate.css>` | string | — | Generated theme to compare |
| `--check` | boolean | false | Exit 1 if anything is missing or any rule below is broken |

Checks, each reported as a finding with a clear message:

1. `@theme` tokens (`--font-*`, `--color-*`, `--radius-*`, `--shadow-*`, `--ease-*`) present in reference but missing in candidate; likely renames (missing name with a new name of the same prefix and value).
2. Classes defined in `@layer components` and `@layer base` of the reference but missing in the candidate.
3. `@utility` names missing.
4. Dark-selector coverage: every `--color-*` and `--shadow-*` overridden in both `:root[data-theme="dark"]` and the `prefers-color-scheme` fallback.
5. First-two-lines rule: the first two statements (ignoring comments and blank lines) are `@import "tailwindcss";` and `@source "../";`.
6. `!important` anywhere outside the `prefers-reduced-motion` block.
7. External `@import` (`http(s)://`, `//`, Google Fonts) — only bare package imports are allowed.

Additions (new tokens/classes) are listed as info, never failures.

**Output**: human list grouped by check; with `--json`: `{ok, missing:{tokens[], classes[], utilities[]}, renamed:[{from,to}], dark_missing:{data_theme[], media[]}, first_lines_ok, important:[{line,text}], external_imports:[], added:{tokens[], classes[]}}`.

**Exit codes**: 0 contract preserved (or without `--check`, always 0 if both files parsed); 1 with `--check` and any finding; 2 unreadable file.

---

## `validate-index.mjs`

`validate-index.mjs [--index <path>] [--schema <path>] [--rejected <path>] [--live]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--index <path>` | string | `index/sites.json` | Index to validate |
| `--schema <path>` | string | `index/schema.json` | JSON Schema (draft 2020-12 subset, validated with a stdlib validator) |
| `--rejected <path>` | string | `index/rejected.json` | Rejected list to cross-check against |
| `--live` | boolean | false | Also run `probe --quick` on every entry and report dead ones |

Checks: schema conformance, unique `id`, unique canonical `url`, entries with `status: "dead"` flagged, any url also present in `rejected.json`.

**Output**: table of violations then a summary line; with `--json`: `{ok, entries, violations:[{id, url, rule, message}], dead:[id], live_checked?: n}`.

**Exit codes**: 0 valid; 1 any violation (dead entries are a violation); 2 unreadable file or invalid schema.

---

## `crawl-awwwards.mjs`

`crawl-awwwards.mjs [--limit <n>] [--pages <n>] [--collections <list>] [--no-score]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--limit <n>` | number | none | Stop after n unique candidates |
| `--pages <n>` | number | 1 | Listing pages per collection |
| `--collections <list>` | list | `sotd,sotm,developer,minimal,typography,portfolio,e-commerce,editorial,startup` | Award collections and tags to crawl |
| `--no-score` | boolean | — | Skip fetching each award page for its score (faster; `score: null`) |

1 req/s, real UA, respects `robots.txt` disallows. Resolves award pages to the external site URL.

**Output**: candidate JSONL with `source: "awwwards"` on stdout; summary (pages fetched, candidates, skipped by robots, errors) on stderr.

**Exit codes**: 0 at least one candidate; 1 zero candidates (blocked or layout changed); 2 usage error.

---

## `crawl-cssda.mjs`

`crawl-cssda.mjs [--limit <n>] [--pages <n>] [--collections <list>]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--limit <n>` | number | none | Stop after n unique candidates |
| `--pages <n>` | number | 1 | Listing pages per collection |
| `--collections <list>` | list | `gallery,wotd,wotm` | CSS Design Awards collections |

Same politeness rules as Awwwards.

**Output**: candidate JSONL with `source: "cssda"`; summary on stderr.

**Exit codes**: 0 at least one candidate; 1 zero candidates; 2 usage error.

---

## `crawl-behance.mjs`

`crawl-behance.mjs [--limit <n>] [--max-minutes <n>]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--limit <n>` | number | none | Stop after n kept candidates |
| `--max-minutes <n>` | number | 15 | Hard wall-clock budget |

Home feed only. Requires Playwright. Skips any URL disallowed by Behance's `robots.txt`. Keeps only projects whose page links a live external website (the external site becomes `url`, the project page `source_url`).

**Output**: candidate JSONL with `source: "behance"`; stderr summary including why it stopped (budget, blocked, limit).

**Exit codes**: 0 at least one candidate; 1 ran but kept zero candidates; 2 usage error or Playwright unavailable (reason on stderr).

---

## `rank.mjs`

`rank.mjs --brief <brief.json> [--index <path>] [--taste <path>] [--n <n>]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--brief <brief.json>` | string | — (required) | Brief JSON (shape above) |
| `--index <path>` | string | `index/sites.json` | Index to rank |
| `--taste <path>` | string | `index/taste.md` | Taste profile; weights are read from the ` ```json ` fence under `## Weights` |
| `--n <n>` | number | 5 | Number of candidates (skills pass `${user_config.max_candidates}`) |

Scores every `live` entry: tag overlap, taste weights, source score, recency, penalties for `avoid` conflicts and motion above budget. Diversity: never two candidates with the same mood + typography combination; prefers one safe and one bolder pick. **Deterministic**: same inputs, same output (ties broken by `id`).

**Output** (JSON on stdout regardless of `--json`):

```jsonc
{
  "candidates": [{ "id", "score", "reasons": [], "take": [], "leave": "…" }],
  "combinations": [{ "label": "A", "parts": [{"id","take":[]}], "character": "…" }],
  "excluded": [{ "id", "reason" }]
}
```

**Exit codes**: 0 ranked; 1 fewer than 3 eligible candidates; 2 unreadable brief/index/taste or missing weights fence.

---

## `index-edit.mjs`

`index-edit.mjs <command> [options] [--index <path>] [--rejected <path>]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<command>` | string | — | One of the commands below |
| `--index <path>` | string | `index/sites.json` | Index file |
| `--rejected <path>` | string | `index/rejected.json` | Rejected list |
| `--entry <file\|->` | string | — | `upsert`: entry JSON from a file or `-` for stdin |
| `--id <id>` | string | — | `set-status`: entry id |
| `--status <s>` | string | — | `set-status`: `live` \| `dead` \| `unchecked` (also sets `last_checked` to today) |
| `--url <u>` | string | — | `reject`: url to reject (removed from the index if present) |
| `--reason <text>` | string | — | `reject`: one-line reason |
| `--candidates <jsonl>` | string | — | `diff`: candidate JSONL file (or `-`) |
| `--from <glob>` | string | — | `merge`: glob of JSON/JSONL entry files to merge into the index |

Commands:

- `upsert --entry <json-file|->` — insert or replace by `id`; validates against the schema before writing.
- `set-status --id <id> --status live|dead|unchecked`
- `reject --url <u> --reason <text>` — append `{url, reason, date}` to `rejected.json`.
- `diff --candidates <jsonl>` — print (JSONL) candidates whose url is in neither `sites.json` nor `rejected.json`.
- `stats` — counts per source, kind, mood, status, anchors.
- `merge --from <glob>` — upsert every entry found; reports conflicts.

Writes are atomic (temp file + rename) and keep the file sorted by `id` with 2-space indentation.

**Output**: human summary; with `--json` a `{ok, changed, …}` object (`diff` always JSONL).

**Exit codes**: 0 done; 1 validation failed (nothing written) or id not found; 2 usage error.

---

## `preview.mjs`

`preview.mjs <theme.css> --out <dir> [--html-only]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<theme.css>` | string | — | Generated theme |
| `--out <dir>` | string | — (required) | Output directory |
| `--html-only` | boolean | false | Write `preview.html` only; skip screenshots (no Playwright needed) |

Writes `preview.html` (self-contained, no external requests: tokens + component classes inlined as plain CSS; hero with eyebrow/display/lead, two `.btn`, chips, three `.card-link`, a `.prose` block, light and dark), plus `preview-light.jpg` and `preview-dark.jpg`, each ≤ 300 KB.

**Output**: paths written (JSON with `--json`: `{html, light, dark}`).

**Exit codes**: 0 written; 1 theme could not be rendered; 2 usage error, or Playwright unavailable without `--html-only`.

---

## `fonts.mjs`

`fonts.mjs <family...> [--map <path>] [--verify]`

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<family...>` | string(s) | — | One or more observed font-family names |
| `--map <path>` | string | `index/fonts.json` | Proprietary → open-alternative map |
| `--verify` | boolean | false | Query the npm registry to confirm each package exists and read its subsets |

**Output** (JSON on stdout):

```jsonc
[{ "observed": "GT America", "family": "Inter", "package": "@fontsource-variable/inter",
   "variable": true, "cyrillic": true, "import": "@import \"@fontsource-variable/inter/wght.css\";",
   "alternative": true, "verified": true }]
```

Variable packages are preferred; `cyrillic` reports subset coverage.

**Exit codes**: 0 every family mapped; 1 some family unmapped or failed verification; 2 usage error or registry unreachable with `--verify`.

---

## `ensure-deps.sh`

`ensure-deps.sh <plugin-root> <data-dir> [--browsers] [--json]` (bash)

| Flag/Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `<plugin-root>` | string | — | `${CLAUDE_PLUGIN_ROOT}` |
| `<data-dir>` | string | — | `${CLAUDE_PLUGIN_DATA}` |
| `--browsers` | boolean | false | Also install Playwright `chromium-headless-shell` into `<data-dir>/browsers` |
| `--json` | boolean | false | Print a JSON status object on stdout |

Copies `scripts/package.json` + `package-lock.json` into `<data-dir>/deps` and runs `npm ci` there once, stamped by the lock-file hash (re-runs only when the lock changes). Never installs into the plugin root.

**Output** (`--json`): `{"deps":"ok|installed|failed","browsers":"ok|installed|failed|skipped","fallback":null|"static","data":"…"}`.

**Exit codes**: 0 deps ready (browser-install failure still exits 0 and reports `fallback: "static"`); 1 `npm ci` failed; 2 usage error or npm/node missing.

---

## `test.sh`

`bash scripts/test.sh` (bash, no flags)

Runs in order and stops on the first failure:

1. `claude plugin validate . --strict` (skipped with a notice when the `claude` CLI is not installed, e.g. in CI)
2. `node --test tests/`
3. `node scripts/validate-index.mjs`
4. `node scripts/contrast.mjs fixtures/theme.reference.css`
5. `node scripts/contract.mjs fixtures/theme.reference.css fixtures/theme.reference.css --check`, then against a copy with one token renamed — must exit 1

**Exit codes**: 0 all passed; 1 any check failed.
