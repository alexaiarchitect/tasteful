# scripts/lib

Shared, dependency-free helpers for every `scripts/*.mjs`:

- `args.mjs` — `parseArgs(argv, spec)`, `usageText(spec)`, `fail(msg, code=2)`, `EXIT_OK/EXIT_FAIL/EXIT_USAGE`. Adds `--help`, `--json`, `--data` to every script.
- `log.mjs` — `log.info/warn/error/debug` (debug only with `TASTEFUL_DEBUG=1`) and `progress(i, n, label)`, all on stderr with a `[tasteful]` prefix.
- `deps.mjs` — `dataDir(opts)`, `loadPlaywright(data)` (returns `null`, never throws), `depsStatus(data)`.

Convention: **stdout carries only the result** (JSON with `--json`, otherwise a human table); **all logs go to stderr**.
Exit codes: 0 success, 1 check failed / violation found, 2 usage or environment error.
The full per-script CLI contract is in `docs/SCRIPTS.md`.
