# plugin-evals

Eval cases for `claude plugin eval`, wired up by `"experimental": {"evals": "plugin-evals"}` in `.claude-plugin/plugin.json`.

## Case layout

Each case is a directory:

```
plugin-evals/<case-name>/
├── case.yaml       # schema_version "1.1", name, context.scaffold_script
├── scaffold.sh     # calls ../scaffold.sh <case> with the eval workspace as cwd
├── prompt.md       # frontmatter: max_turns, allowed_tools, tags; body = the user prompt
└── graders/
    └── *.md        # one grader per file: tool_used, regex, file_exists or llm
```

`plugin-evals/scaffold.sh <case>` is shared: it copies `fixtures/theme.reference.css` to `packages/theme/src/styles/theme.css` in the workspace (the default `theme_path`) and writes each case's fixtures (for `overlay-missing-dark`, a site layer at `apps/dji/src/styles/site.css`, the default `site_layer_path`). The eval sandbox has no Playwright, so every case works with static or quick probes and the dependency-free `contract.mjs` / `contrast.mjs`.

| Case | Skill | What it checks |
| --- | --- | --- |
| `find-brief` | find | Full brief, no questions: `rank.mjs` and `probe.mjs --quick` run, `brief.json` + `proposal.md` written, 3–5 candidates with take/leave, combinations, the approval sentence, no extraction |
| `extract-refuses-without-approval` | extract | A proposal exists but no approval: no deep probe, no theme, no `approval.md`; asks for approval |
| `contract-rename-detected` | extract (verify) | One token renamed: `contract.mjs` reports `--color-accent-soft` → `--color-accent-tint`; file not edited |
| `contrast-floor` | extract (verify) | Light `--color-muted` at ≈ 2.44:1: `contrast.mjs` failure reported with ratio and fix; file not edited |
| `overlay-missing-dark` | extract (verify) | Site layer `apps/dji/src/styles/site.css` sets `--color-bg`/`--color-ink` with only the `data-theme` dark block: `contract.mjs --overlay` runs, the missing `prefers-color-scheme` fallback is named with the fix (same values); no file edited |
| `add-confirms-before-writing` | add | Probes the url, drafts the entry and asks; never runs `index-edit.mjs upsert` without confirmation |

Results are written to `plugin-evals/results/` (gitignored).

## Running

```sh
claude plugin eval . --scaffold --allow-tools Bash Write Edit --judge-model claude-sonnet-5-5 --runs 1 --max-cost-usd 5
```

`--scaffold` is required (the cases' fixtures come from their scaffold scripts), and `--allow-tools` must grant `Bash`, `Write` and `Edit`: inside an eval run a skill's own `allowed-tools` does not grant anything.

**Run evals from a copy outside `~/Documents`.** On macOS, `--scaffold` hits `EPERM` when the plugin lives under `~/Documents` (a sandbox/TCC restriction), so copy the repo first:

```sh
rsync -a --exclude .git --exclude node_modules ~/Documents/Business/alexaiarchitect/tasteful/ /tmp/tasteful-eval/
cd /tmp/tasteful-eval && claude plugin eval . --scaffold --allow-tools Bash Write Edit --judge-model claude-sonnet-5-5 --runs 1 --max-cost-usd 5
```
