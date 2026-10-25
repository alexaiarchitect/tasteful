# Changelog

## 0.2.0 — 2026-10-25

- Site layers: a look for one site now ships as a small overlay, `apps/<site>/src/styles/site.css`, over the shared theme instead of replacing it.
- `scripts/overlay.mjs` (new): derives the layer from a full generated theme — header comment, new `@fontsource` imports, unlayered `:root` with changed tokens, both dark selectors (identical), `@layer base` / `@layer components` rule deltas; resets base declarations the full theme deleted with `unset` (`removed`), inlines `var()` references to theme-only tokens (`inlined`), skips `@utility`, self-checks before writing. Diff logic in `scripts/lib/overlay.mjs`.
- `contract.mjs --overlay`: tokens exist in the base, every `var()` resolves to a base or layer token, dark symmetry and agreement, no Tailwind-only statements or external imports, `!important` only in reduced motion, overridden selectors exist in the base. `contrast.mjs --overlay`: merges base and layer tokens per scheme, then the usual pairs. Both stay dependency-free so the `sites` repo vendors them.
- Brief JSON: optional `site` (app folder under `apps/`). `find` offers "Site layer for `<site>`" in its single question when the project has app folders and the brief names one.
- `extract`: derives and checks the layer when `brief.site` is set, hands it to the critic, adds a "Site layer" section to REPORT.md, prints Path B swap-in steps (`pnpm --filter <site> add`, Shell.astro import order); `verify` accepts `<base> <site.css>` or a single layer. `fonts.json` gains an `install` command per package. The critic checks layers (both overlay checks, no renames, both dark blocks, resets placed before the rule's declarations, inlined values match, removed/inlined counts reported).
- New user setting `site_layer_path` (default `apps/{site}/src/styles/site.css`).
- Docs: `SITES-INTEGRATION.md` split into "Which path?", Path A (shared theme, `shared-theme` label) and Path B (site layer); `WORKFLOW.md` step 3b; `SCRIPTS.md`; README.
- Tests for overlay derivation and both `--overlay` checks, a known-good layer fixture (`fixtures/runs/ai-architect-blog/site.ai-architect-blog.css`), and the `overlay-missing-dark` eval case.

## 0.1.0 — 2026-10-24

- Plugin manifest (`tasteful`, Apache-2.0) with `theme_path`, `output_dir` and `max_candidates` user settings, and a single-plugin marketplace.
- Skills: `find` (brief → ranked, live-verified proposal with combinations), `extract` (approval-gated, contract-preserving `theme.<slug>.css`, `fonts.json`, `REPORT.md`, preview, plus a `verify` mode), `add` (probe-and-confirm, with an assisted Behance mode via Claude in Chrome), `refresh` (polite crawls reviewed in batches of 10), `rate` (feedback log and rule promotion in `taste.md`), `check` (liveness and screenshot refresh).
- `tasteful:critic` agent: independent review of extract output — contract, contrast in both schemes, self-hosted Cyrillic fonts, fidelity to the approved references, template tells — returning blocking issues and nits with evidence.
- Scripts (Node ≥ 22, ESM): `probe`, `rank`, `contrast`, `contract`, `validate-index`, `index-edit`, `preview`, `fonts`, crawlers for Awwwards, CSS Design Awards and Behance, `ensure-deps.sh` (deps and Chromium in the plugin data dir), `test.sh`. CLI contract in `docs/SCRIPTS.md`.
- Index: `sites.json` with JSON Schema, `rejected.json`, `sources.json`, `fonts.json` (proprietary → open alternatives) and the taste profile `taste.md` with ranking weights.
- Docs: `WORKFLOW.md`, `INDEX-SCHEMA.md` (including Behance findings), `SITES-INTEGRATION.md`, `SCRIPTS.md`.
- Tests (`node --test`), five `claude plugin eval` cases in `plugin-evals/`, and a GitHub Actions workflow running the node checks.
- Verification on 2026-10-24: `scripts/test.sh` green (93 node tests), `claude plugin validate --strict` clean, `claude plugin eval` 5/5 cases pass (score 1.0 with the plugin vs 0.14–1.0 baseline), end-to-end find × 3 and extract × 1 recorded under `fixtures/runs/`.
