#!/usr/bin/env bash
# Runs the shared plugin-evals/scaffold.sh with this case's name (cwd = eval workspace).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$here/../scaffold.sh" "$(basename "$here")"
