#!/usr/bin/env bash
# tasteful — scripts/test.sh
# Runs the plugin checks in order and stops on the first failure (docs/SCRIPTS.md → test.sh).
# Usage: bash scripts/test.sh   (from any directory)
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n[tasteful] == %s\n' "$*" >&2; }

step "1/7 claude plugin validate . --strict"
if command -v claude >/dev/null 2>&1; then
  claude plugin validate . --strict
else
  echo "[tasteful] notice: claude CLI not installed, skipping plugin validation" >&2
fi

step "2/7 node --test"
# Node >= 22 does not expand a bare directory argument, so pass the glob explicitly.
node --test 'tests/**/*.test.mjs'

step "3/7 validate-index"
node scripts/validate-index.mjs

step "4/7 contrast on the reference theme"
node scripts/contrast.mjs fixtures/theme.reference.css

step "5/7 contract: reference vs reference, then vs a renamed token"
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

step "6/7 site layer: the ai-architect-blog overlay passes contract --overlay and contrast --overlay"
node scripts/contract.mjs fixtures/theme.reference.css fixtures/runs/ai-architect-blog/site.ai-architect-blog.css --overlay --check
node scripts/contrast.mjs fixtures/theme.reference.css --overlay fixtures/runs/ai-architect-blog/site.ai-architect-blog.css

step "7/7 site layer: a layer without the prefers-color-scheme dark block is rejected"
set +e
out="$(node scripts/contract.mjs fixtures/theme.reference.css tests/fixtures/overlay-missing-dark.css --overlay --check)"
code=$?
set -e
if [ "$code" -ne 1 ]; then
  echo "[tasteful] error: contract --overlay on the missing-dark fixture exited $code, expected 1" >&2
  exit 1
fi
if ! grep -q -- '--color-bg' <<<"$out"; then
  echo "[tasteful] error: contract --overlay output for the missing-dark fixture does not mention --color-bg" >&2
  exit 1
fi
echo "[tasteful] missing-dark overlay fixture correctly rejected:" >&2
grep -- '--color-bg' <<<"$out" >&2

printf '\n[tasteful] all checks passed\n' >&2
