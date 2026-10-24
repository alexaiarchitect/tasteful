#!/usr/bin/env bash
# tasteful — scripts/ensure-deps.sh
#
# Usage: ensure-deps.sh <plugin-root> <data-dir> [--browsers] [--json]
#
# Installs the scripts' npm dependencies (playwright only) into
# <data-dir>/deps — never into the plugin root. `npm ci` runs once per
# lock-file hash (stamp file <data-dir>/deps/.ok-<sha256>). Scripts load the
# deps with createRequire(<data-dir>/deps/package.json) (scripts/lib/deps.mjs),
# so no NODE_PATH or symlink is needed.
#
# --browsers also makes sure a Chromium headless shell is available: if a
# quick launch probe already works with Playwright's default cache
# (~/Library/Caches/ms-playwright, ~/.cache/ms-playwright) nothing is
# downloaded; otherwise it installs into <data-dir>/browsers
# (PLAYWRIGHT_BROWSERS_PATH). A browser failure still exits 0 and reports
# fallback "static".
#
# Exit codes: 0 deps ready · 1 npm ci failed · 2 usage error or node/npm missing.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ensure-deps.sh <plugin-root> <data-dir> [--browsers] [--json]

Install the tasteful scripts' npm deps into <data-dir>/deps (npm ci, stamped
by the lock-file hash) and optionally a Playwright chromium-headless-shell.

Arguments:
  <plugin-root>   ${CLAUDE_PLUGIN_ROOT}
  <data-dir>      ${CLAUDE_PLUGIN_DATA}

Options:
  --browsers      Also make sure chromium-headless-shell is installed
                  (reuses Playwright's default cache when it already works,
                  otherwise installs into <data-dir>/browsers)
  --json          Print {"deps","browsers","fallback","data"} on stdout
  -h, --help      Show this help and exit

Exit codes: 0 deps ready (browser failure still 0, fallback "static"),
1 npm ci failed, 2 usage error or node/npm missing.
EOF
}

log() { printf '[tasteful] %s\n' "$*" >&2; }

ROOT=""
DATA=""
WANT_BROWSERS=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --browsers) WANT_BROWSERS=1 ;;
    --no-browsers) WANT_BROWSERS=0 ;;
    --json) JSON=1 ;;
    --*) log "error: unknown option $arg"; usage >&2; exit 2 ;;
    *)
      if [[ -z "$ROOT" ]]; then ROOT="$arg"
      elif [[ -z "$DATA" ]]; then DATA="$arg"
      else log "error: unexpected argument $arg"; exit 2
      fi ;;
  esac
done

if [[ -z "$ROOT" || -z "$DATA" ]]; then
  log "error: <plugin-root> and <data-dir> are required"
  usage >&2
  exit 2
fi
if [[ ! -f "$ROOT/scripts/package.json" || ! -f "$ROOT/scripts/package-lock.json" ]]; then
  log "error: $ROOT/scripts/package.json or package-lock.json not found"
  exit 2
fi
command -v node >/dev/null 2>&1 || { log "error: node not found on PATH"; exit 2; }
command -v npm >/dev/null 2>&1 || { log "error: npm not found on PATH"; exit 2; }

json_escape() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }

DEPS_STATE="failed"
BROWSERS_STATE="skipped"
FALLBACK="null"

emit() {
  if [[ "$JSON" == 1 ]]; then
    printf '{"deps":"%s","browsers":"%s","fallback":%s,"data":%s}\n' \
      "$DEPS_STATE" "$BROWSERS_STATE" "$FALLBACK" "$(json_escape "$DATA")"
  else
    printf 'deps      %s\nbrowsers  %s\nfallback  %s\ndata      %s\n' \
      "$DEPS_STATE" "$BROWSERS_STATE" "$FALLBACK" "$DATA"
  fi
}

mkdir -p "$DATA/deps"
DATA="$(cd "$DATA" && pwd)"
DEPS="$DATA/deps"

if command -v shasum >/dev/null 2>&1; then
  HASH="$(shasum -a 256 "$ROOT/scripts/package-lock.json" | cut -c1-64)"
else
  HASH="$(sha256sum "$ROOT/scripts/package-lock.json" | cut -c1-64)"
fi
STAMP="$DEPS/.ok-$HASH"

if [[ -f "$STAMP" && -d "$DEPS/node_modules/playwright" ]]; then
  DEPS_STATE="ok"
  log "deps up to date ($DEPS)"
else
  cp "$ROOT/scripts/package.json" "$ROOT/scripts/package-lock.json" "$DEPS/"
  log "installing deps into $DEPS (npm ci)"
  if (cd "$DEPS" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >&2); then
    rm -f "$DEPS"/.ok-* 2>/dev/null || true
    : > "$STAMP"
    DEPS_STATE="installed"
  else
    log "error: npm ci failed in $DEPS"
    DEPS_STATE="failed"
    FALLBACK='"static"'
    emit
    exit 1
  fi
fi

# Launch probe: exit 0 when chromium headless shell starts within 20 s.
launch_probe() {
  # $1 = PLAYWRIGHT_BROWSERS_PATH value or empty for the default cache
  local env_path="$1"
  (
    if [[ -n "$env_path" ]]; then export PLAYWRIGHT_BROWSERS_PATH="$env_path"; else unset PLAYWRIGHT_BROWSERS_PATH; fi
    cd "$DEPS" && node -e '
      const { createRequire } = require("node:module");
      const t = setTimeout(() => { console.error("[tasteful] launch probe timed out"); process.exit(1); }, 20000);
      (async () => {
        let b;
        try {
          const pw = createRequire(process.cwd() + "/package.json")("playwright");
          b = await pw.chromium.launch({ headless: true });
          await (await b.newPage()).close();
          process.exitCode = 0;
        } catch (e) {
          console.error("[tasteful] launch probe failed:", String(e.message).split("\n")[0]);
          process.exitCode = 1;
        } finally {
          if (b) await b.close().catch(() => {});
          clearTimeout(t);
        }
      })();
    ' >&2
  )
}

if [[ "$WANT_BROWSERS" == 1 ]]; then
  BDIR="$DATA/browsers"
  if [[ -d "$BDIR" && -n "$(ls -A "$BDIR" 2>/dev/null)" ]] && launch_probe "$BDIR"; then
    BROWSERS_STATE="ok"
    log "browsers ok ($BDIR)"
  elif [[ ! -d "$BDIR" || -z "$(ls -A "$BDIR" 2>/dev/null)" ]] && launch_probe ""; then
    BROWSERS_STATE="ok"
    log "browsers ok (Playwright default cache)"
  else
    log "installing chromium-headless-shell into $BDIR"
    mkdir -p "$BDIR"
    if PLAYWRIGHT_BROWSERS_PATH="$BDIR" "$DEPS/node_modules/.bin/playwright" install chromium-headless-shell >&2 \
        && launch_probe "$BDIR"; then
      BROWSERS_STATE="installed"
    else
      log "warn: browser install failed; probe will use the static fallback"
      BROWSERS_STATE="failed"
      FALLBACK='"static"'
      # Do not leave an empty dir behind: loadPlaywright() would ignore it anyway.
      rmdir "$BDIR" 2>/dev/null || true
    fi
  fi
fi

emit
exit 0
