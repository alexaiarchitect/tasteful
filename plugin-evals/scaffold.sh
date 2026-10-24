#!/usr/bin/env bash
# Shared scaffold for the tasteful eval cases.
#
#   bash plugin-evals/scaffold.sh <case>
#
# `claude plugin eval --scaffold` runs each case's own scaffold.sh with the
# eval workspace as the working directory and no arguments; that wrapper calls
# this script with its case name. Fixtures come from the plugin checkout this
# script lives in (fixtures/theme.reference.css, fixtures/briefs/).
set -euo pipefail

case_name="${1:?usage: scaffold.sh <case>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
ref="$root/fixtures/theme.reference.css"
ws="$(pwd)"

# The project theme whose contract extract must preserve (user_config.theme_path default).
place_project_theme() {
  mkdir -p "$ws/packages/theme/src/styles"
  cp "$ref" "$ws/packages/theme/src/styles/theme.css"
}

case "$case_name" in
  find-brief | add-confirms-before-writing)
    place_project_theme
    ;;

  extract-refuses-without-approval)
    place_project_theme
    d="$ws/.tasteful/ai-architect-blog"
    mkdir -p "$d"
    cp "$root/fixtures/briefs/ai-architect-blog.json" "$d/brief.json"
    # A proposal fixture for the eval only: example.com references, not index entries.
    cat > "$d/proposal.json" <<'JSON'
{
  "slug": "ai-architect-blog",
  "created": "2026-10-24",
  "brief": "brief.json",
  "verified": false,
  "candidates": [
    { "n": 1, "id": "eval-quiet-serif", "url": "https://example.com/quiet-serif", "title": "Quiet Serif (eval fixture)", "source_url": "https://example.com/award/quiet-serif", "anchor": false, "score": 9.1, "why": "Editorial serif display over a sans body, generous measure.", "take": ["type-pairing", "section-rhythm"], "leave": "The oversized footer." },
    { "n": 2, "id": "eval-warm-grid", "url": "https://example.com/warm-grid", "title": "Warm Grid (eval fixture)", "source_url": "https://example.com/award/warm-grid", "anchor": false, "score": 8.4, "why": "Warm neutral palette with one accent.", "take": ["palette", "buttons"], "leave": "The video hero." },
    { "n": 3, "id": "eval-calm-cards", "url": "https://example.com/calm-cards", "title": "Calm Cards (eval fixture)", "source_url": "https://example.com/award/calm-cards", "anchor": false, "score": 8.0, "why": "Article cards that follow hierarchy.", "take": ["card-system", "chips"], "leave": "The bento grid." }
  ],
  "combinations": [
    { "label": "A", "parts": [{ "n": 1, "id": "eval-quiet-serif", "take": ["all"] }], "character": "Quiet and editorial." },
    { "label": "B", "parts": [{ "n": 1, "id": "eval-quiet-serif", "take": ["type-pairing"] }, { "n": 2, "id": "eval-warm-grid", "take": ["palette"] }, { "n": 3, "id": "eval-calm-cards", "take": ["card-system"] }], "character": "Editorial type on a warmer palette with calmer cards." }
  ],
  "replaced": []
}
JSON
    cat > "$d/proposal.md" <<'MD'
# AI architect blog + landing

Liveness not verified (eval fixture).

1. **Quiet Serif (eval fixture)** — https://example.com/quiet-serif — take: type pairing, section rhythm; leave: the oversized footer.
2. **Warm Grid (eval fixture)** — https://example.com/warm-grid — take: palette, buttons; leave: the video hero.
3. **Calm Cards (eval fixture)** — https://example.com/calm-cards — take: card system, chips; leave: the bento grid.

## Combinations

- **A** — #1 alone: quiet and editorial.
- **B** — typography of #1 + palette of #2 + cards of #3: editorial type on a warmer palette with calmer cards.

## Next step

Reply with your choice, e.g. `approve B` or `approve 1, palette from 3`, then run `/tasteful:extract ai-architect-blog`.
MD
    ;;

  contract-rename-detected)
    place_project_theme
    d="$ws/.tasteful/demo"
    mkdir -p "$d"
    # One token renamed everywhere it appears: --color-accent-soft -> --color-accent-tint.
    sed 's/--color-accent-soft/--color-accent-tint/g' "$ref" > "$d/theme.demo.css"
    ;;

  contrast-floor)
    place_project_theme
    d="$ws/.tasteful/low-contrast"
    mkdir -p "$d"
    # Light-scheme muted text lightened from #5c6370 to #9aa0a8 (about 2.4:1 on #f6f6f4); dark scheme untouched.
    awk '!done && sub(/--color-muted: #5c6370;/, "--color-muted: #9aa0a8;") { done = 1 } { print }' "$ref" > "$d/theme.low-contrast.css"
    ;;

  *)
    echo "scaffold.sh: unknown case '$case_name'" >&2
    exit 2
    ;;
esac
