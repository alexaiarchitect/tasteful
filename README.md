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

Examples (natural language triggers the same skills):

```
/tasteful:find A trilingual blog + landing for an AI-architecture consultant; calm, precise, warm; text-heavy; motion 1; both schemes
/tasteful:extract ai-architect-blog approve B
/tasteful:extract verify .tasteful/ai-architect-blog/theme.ai-architect-blog.css
/tasteful:add https://example.studio https://www.awwwards.com/sites/example-studio
/tasteful:add behance
/tasteful:refresh awwwards
/tasteful:rate example-studio - autoplay video hero behind text
/tasteful:check --screenshots
```

`/tasteful:add`, `refresh`, `rate` and `check` edit the plugin's own `index/` files. With a marketplace install those live in the plugin cache and are replaced on update, so keep a personal index in a checkout (`claude --plugin-dir`) or a fork.

## How it works

1. **Find** — the brief is parsed into index tags and ranked against `index/sites.json` and `index/taste.md`.
2. Candidates are re-probed live; dead ones are replaced silently.
3. A proposal with 3–5 references and 2–3 combinations is written to `.tasteful/<slug>/proposal.md`.
4. **Approve** — reply `approve B` or `approve 1, palette from 3`; the approval is stored verbatim.
5. **Extract** — references are deep-probed and composed into `theme.<slug>.css`, `fonts.json`, `REPORT.md` and a preview, then checked for contract, contrast and by the critic agent.
6. **Swap in** — you copy the theme into your sites repo on a branch; tasteful never does it for you.

The full flow with commands is in [`docs/WORKFLOW.md`](docs/WORKFLOW.md); the swap-in steps for the `sites` repo are in [`docs/SITES-INTEGRATION.md`](docs/SITES-INTEGRATION.md); every index field is explained in [`docs/INDEX-SCHEMA.md`](docs/INDEX-SCHEMA.md).

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

To add a source: add an entry to `index/sources.json` (id, role, entry url, collections, politeness notes), add the id to the `source` enum in `index/schema.json`, write `scripts/crawl-<id>.mjs` emitting the candidate JSONL from [`docs/SCRIPTS.md`](docs/SCRIPTS.md) (1 req/s, real User-Agent, `robots.txt` respected), and document it in `docs/SCRIPTS.md` and `docs/INDEX-SCHEMA.md` → Sources. Behance details and the assisted mode are in `docs/INDEX-SCHEMA.md` → Behance.

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

```
tasteful/
├── .claude-plugin/{plugin.json, marketplace.json}
├── .github/workflows/check.yml        # node checks on push / PR
├── agents/critic.md
├── skills/{find,extract,add,refresh,rate,check}/SKILL.md
├── index/
│   ├── sites.json  schema.json  rejected.json  sources.json  fonts.json  taste.md
│   └── probes/<id>.json               # stored probe results (shots/ and staging/ are gitignored)
├── scripts/
│   ├── probe.mjs  rank.mjs  contrast.mjs  contract.mjs  validate-index.mjs  index-edit.mjs
│   ├── preview.mjs  fonts.mjs  crawl-awwwards.mjs  crawl-cssda.mjs  crawl-behance.mjs
│   ├── ensure-deps.sh  test.sh  package.json  package-lock.json
│   └── lib/{args,log,deps}.mjs …
├── fixtures/{theme.reference.css, briefs/, runs/}
├── plugin-evals/{scaffold.sh, <case>/…}
├── tests/*.test.mjs
├── docs/{GOAL,SCRIPTS,WORKFLOW,INDEX-SCHEMA,SITES-INTEGRATION}.md
├── README.md  CHANGELOG.md  THIRD_PARTY_NOTICES.md  LICENSE
```

## Development

```sh
bash scripts/test.sh
claude plugin validate . --strict
claude plugin eval . --scaffold --allow-tools Bash Write Edit --judge-model claude-sonnet-5-5 --runs 1 --max-cost-usd 5   # from a copy outside ~/Documents
```

The CLI contract for every script is in [`docs/SCRIPTS.md`](docs/SCRIPTS.md). See [`plugin-evals/README.md`](plugin-evals/README.md) before running evals.

## Attribution

Reference sites in the index belong to their owners; the index stores links, observed design facts and short notes only.
Award data comes from Awwwards, CSS Design Awards and Behance listing pages.

Fonts are never bundled: generated themes import open-licensed `@fontsource` packages (SIL OFL or similar, per package) that you install in your own project; proprietary faces seen on reference sites are only named, with an open alternative.
Screenshots are taken for private reference and review, kept at most 300 KB each, and gitignored under `index/shots/`; only small preview and run screenshots under `fixtures/runs/` are committed. Crawlers run at 1 request per second with a real User-Agent and respect `robots.txt`.
The critic's template-tells checklist is paraphrased from Anthropic's `frontend-design` skill; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for this and other credits.

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Alex (alexaiarchitect).
