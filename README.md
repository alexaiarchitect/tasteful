# tasteful — taste-driven design references for Astro + Tailwind sites

`tasteful` is a Claude Code plugin that finds juried reference sites for a short brief, waits for you to approve a selection, and then extracts a drop-in `theme.css` that keeps your design system's token and class contract.
The taste lives in a curated index (`index/sites.json`) and a taste profile (`index/taste.md`) that you refine with feedback.
Nothing is extracted before you approve, and nothing is written into your sites repo.

## Install

From the marketplace:

```
/plugin marketplace add alexaiarchitect/tasteful
/plugin install tasteful@alexaiarchitect-tasteful
```

Locally, from a checkout:

```
claude --plugin-dir /path/to/tasteful
```

## The skills

| Skill | Use it to |
| --- | --- |
| `/tasteful:find <brief>` | Get 3–5 reference sites for a brief, with what to take from each and suggested combinations |
| `/tasteful:extract <brief-slug> [approval]` | Turn an approved selection into a contract-preserving `theme.<slug>.css`, report and preview |
| `/tasteful:add <url> [source-url]` | Probe a site you found and add it to the index (the path for Behance and anything else) |
| `/tasteful:refresh [source]` | Crawl the sources for new candidates and review them in batches |
| `/tasteful:rate <id\|url> +\|- [note]` | Record taste feedback; repeated signals become rules |
| `/tasteful:check` | Re-probe the index, mark dead sites, refresh screenshots |

<!-- WS-E: one example invocation per skill -->

## How it works

1. **Find** — the brief is parsed into index tags and ranked against `index/sites.json` and `index/taste.md`.
2. Candidates are re-probed live; dead ones are replaced silently.
3. A proposal with 3–5 references and 2–3 combinations is written to `.tasteful/<slug>/proposal.md`.
4. **Approve** — reply `approve B` or `approve 1, palette from 3`; the approval is stored verbatim.
5. **Extract** — references are deep-probed and composed into `theme.<slug>.css`, `fonts.json`, `REPORT.md` and a preview, then checked for contract, contrast and by the critic agent.
6. **Swap in** — you copy the theme into your sites repo on a branch; tasteful never does it for you.

<!-- WS-E: link docs/WORKFLOW.md and docs/SITES-INTEGRATION.md -->

## Theme contract

Every generated theme must:

- keep every `--font-*`, `--color-*`, `--radius-*`, `--shadow-*`, `--ease-*` token of the reference `theme.css` (new tokens allowed, none removed or renamed);
- keep every class of `@layer components` and `@layer base` and every `@utility`, with the same role;
- override every colour and shadow token for dark mode in both `:root[data-theme="dark"]` and the `prefers-color-scheme` fallback;
- self-host fonts via `@fontsource-variable/*` or `@fontsource/*` (no Google Fonts, no external CSS), preferring variable fonts with Cyrillic;
- start with `@import "tailwindcss";` and `@source "../";`;
- meet the contrast floor in both schemes: ink/bg ≥ 7:1, muted/bg ≥ 4.5:1, accent-ink/accent ≥ 4.5:1, accent/bg ≥ 3:1;
- keep `prefers-reduced-motion` handling and use no `!important` outside it.

The contract source of truth for tests is `fixtures/theme.reference.css`.

## Sources

| Source | Role |
| --- | --- |
| `awwwards` | Primary, juried, with scores and tags |
| `cssda` | Primary, juried (CSS Design Awards), with scores |
| `behance` | Volume source, noisy; crawling is best effort and skips anything `robots.txt` disallows, so `/tasteful:add` is the supported path for Behance finds |
| `manual` | Anything you add yourself with `/tasteful:add` |

Template marketplaces are excluded. Sources are configured in `index/sources.json`.

<!-- WS-E: how to add a source -->

## Requirements

- Claude Code with plugin support
- Node.js ≥ 22 and npm
- Network access for probing and crawling
- Playwright and Chromium are installed on first use into the plugin data dir (`${CLAUDE_PLUGIN_DATA}`), never into the plugin itself; without them, scripts fall back to static fetch-based probing

## Layout

```
.claude-plugin/   plugin.json, marketplace.json
skills/           find, extract, add, refresh, rate, check
agents/           critic.md — independent reviewer for extract output
index/            sources.json, sites.json, schema.json, taste.md, rejected.json
scripts/          probe, crawlers, contrast, contract, rank, index-edit, preview, fonts (see docs/SCRIPTS.md)
fixtures/         theme.reference.css, sample briefs, recorded runs
plugin-evals/     eval cases for `claude plugin eval`
tests/            node --test suites
docs/             GOAL.md, SCRIPTS.md and the workflow/integration/schema guides
```

<!-- WS-E: final tree once all workstreams land -->

## Development

```sh
bash scripts/test.sh
claude plugin validate . --strict
claude plugin eval . --allow-tools Bash Write Edit --judge-model claude-sonnet-5-5 --runs 1
```

The CLI contract for every script is in [`docs/SCRIPTS.md`](docs/SCRIPTS.md). See [`plugin-evals/README.md`](plugin-evals/README.md) before running evals.

## Attribution

Reference sites in the index belong to their owners; the index stores links, observed design facts and short notes only.
Award data comes from Awwwards, CSS Design Awards and Behance listing pages.

<!-- WS-E: font licences and screenshot policy -->

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Alex (alexaiarchitect).
