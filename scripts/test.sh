#!/usr/bin/env bash
# tasteful — scripts/test.sh
# Runs the plugin checks in order and stops on the first failure (docs/SCRIPTS.md → test.sh).
# Usage: bash scripts/test.sh   (from any directory)
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n[tasteful] == %s\n' "$*" >&2; }

step "1/5 claude plugin validate . --strict"
if command -v claude >/dev/null 2>&1; then
  claude plugin validate . --strict
else
  echo "[tasteful] notice: claude CLI not installed, skipping plugin validation" >&2
fi

step "2/5 node --test"
# Node >= 22 does not expand a bare directory argument, so pass the glob explicitly.
node --test 'tests/**/*.test.mjs'

step "3/5 validate-index"
node scripts/validate-index.mjs

step "4/5 contrast on the reference theme"
node scripts/contrast.mjs fixtures/theme.reference.css

step "5/5 contract: reference vs reference, then vs a renamed token"
node scripts/contract.mjs fixtures/theme.reference.css fixtures/theme.reference.css --check

set +e
out="$(node scripts/contract.mjs fixtures/theme.reference.css tests/fixtures/renamed-token.css --check)"
code=$?
set -e
if [ "$code" -ne 1 ]; then
  echo "[tasteful] error: contract check on the renamed-token fixture exited $code, expected 1" >&2
  exit 1
fi
if ! grep -q -- '--color-ink' <<<"$out"; then
  echo "[tasteful] error: contract output for the renamed-token fixture does not mention --color-ink" >&2
  exit 1
fi
echo "[tasteful] renamed-token fixture correctly rejected:" >&2
grep -- '--color-ink' <<<"$out" >&2

printf '\n[tasteful] all checks passed\n' >&2
