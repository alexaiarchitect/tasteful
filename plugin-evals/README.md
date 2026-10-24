# plugin-evals

Eval cases for `claude plugin eval`, wired up by `"experimental": {"evals": "plugin-evals"}` in `.claude-plugin/plugin.json`.

## Case layout

Each case is a directory:

```
plugin-evals/<case-name>/
├── case.yaml       # metadata: which skill it exercises, setup, files to seed, expected artifacts
├── prompt.md       # the user prompt sent to Claude with the plugin loaded
└── graders/
    └── *.md        # one rubric per file, scored by the judge model
```

Results are written to `plugin-evals/results/` (gitignored).

## Running

```sh
claude plugin eval . --allow-tools Bash Write Edit --judge-model claude-sonnet-5-5 --runs 1
```

**Run evals from a copy outside `~/Documents`.** On macOS, `--scaffold` hits `EPERM` when the plugin lives under `~/Documents` (a sandbox/TCC restriction), so copy the repo first:

```sh
rsync -a --exclude .git --exclude node_modules ~/Documents/Business/alexaiarchitect/tasteful/ /tmp/tasteful-eval/
cd /tmp/tasteful-eval && claude plugin eval . --allow-tools Bash Write Edit --judge-model claude-sonnet-5-5 --runs 1
```
