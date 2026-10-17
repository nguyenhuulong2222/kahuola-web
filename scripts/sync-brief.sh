#!/usr/bin/env bash
# sync-brief.sh — copy the repo's morning-brief generator to the folder the n8n
# container runs it from (/data/assets/insights inside the container).
#
# The repo copy (scripts/insights/generate-brief.mjs) is the single source of
# truth (SAT-0b-4 ruling). The n8n copy drifted once already: it missed the
# SAT-0a-2 smoke wording and still read smoke.present. Run this after every
# change to the repo copy, and as step 2 of the n8n restart runbook
# (docs/BUILD_ROADMAP.md).
#
# Writes ONLY generate-brief.mjs in the destination, plus a one-time backup of
# the file it replaces (generate-brief.mjs.bak-<UTC timestamp>) when the two
# differ. Nothing else in that folder is touched.
#
# Usage: scripts/sync-brief.sh            (default destination)
#        BRIEF_ASSETS_DIR=/path scripts/sync-brief.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/insights/generate-brief.mjs"
DEST_DIR="${BRIEF_ASSETS_DIR:-/Users/longnguyen/kahuola/assets/insights}"
DEST="$DEST_DIR/generate-brief.mjs"

[ -f "$SRC" ] || { echo "sync-brief: source not found: $SRC" >&2; exit 1; }
[ -d "$DEST_DIR" ] || { echo "sync-brief: destination folder not found: $DEST_DIR" >&2; exit 1; }

# Refuse to ship a copy that does not pass its own fixture tests.
node --check "$SRC"
node "$SRC" --test > /dev/null || { echo "sync-brief: source fixture tests FAILED — not syncing" >&2; exit 1; }

if [ -f "$DEST" ] && cmp -s "$SRC" "$DEST"; then
  echo "sync-brief: already in sync ($DEST)"
  exit 0
fi

if [ -f "$DEST" ]; then
  BAK="$DEST.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$DEST" "$BAK"
  echo "sync-brief: backed up previous copy → $BAK"
fi

cp "$SRC" "$DEST"
cmp -s "$SRC" "$DEST" || { echo "sync-brief: copy verification FAILED" >&2; exit 1; }
node "$DEST" --test > /dev/null || { echo "sync-brief: destination fixture tests FAILED" >&2; exit 1; }
echo "sync-brief: synced $SRC → $DEST ($(wc -c < "$DEST" | tr -d ' ') bytes), tests pass"
