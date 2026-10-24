# Changelog

## 0.1.0 — 2026-10-24

- Plugin manifest (`tasteful`, Apache-2.0) with `theme_path`, `output_dir` and `max_candidates` user settings, and a single-plugin marketplace.
- Skills: `find` (brief → ranked, live-verified proposal with combinations), `extract` (approval-gated, contract-preserving `theme.<slug>.css`, `fonts.json`, `REPORT.md`, preview, plus a `verify` mode), `add` (probe-and-confirm, with an assisted Behance mode via Claude in Chrome), `refresh` (polite crawls reviewed in batches of 10), `rate` (feedback log and rule promotion in `taste.md`), `check` (liveness and screenshot refresh).
- `tasteful:critic` agent: independent review of extract output — contract, contrast in both schemes, self-hosted Cyrillic fonts, fidelity to the approved references, template tells — returning blocking issues and nits with evidence.
- Scripts (Node ≥ 22, ESM): `probe`, `rank`, `contrast`, `contract`, `validate-index`, `index-edit`, `preview`, `fonts`, crawlers for Awwwards, CSS Design Awards and Behance, `ensure-deps.sh` (deps and Chromium in the plugin data dir), `test.sh`. CLI contract in `docs/SCRIPTS.md`.
- Index: `sites.json` with JSON Schema, `rejected.json`, `sources.json`, `fonts.json` (proprietary → open alternatives) and the taste profile `taste.md` with ranking weights.
- Docs: `WORKFLOW.md`, `INDEX-SCHEMA.md` (including Behance findings), `SITES-INTEGRATION.md`, `SCRIPTS.md`.
- Tests (`node --test`), five `claude plugin eval` cases in `plugin-evals/`, and a GitHub Actions workflow running the node checks.
