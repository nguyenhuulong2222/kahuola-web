#!/usr/bin/env bash
# deploy.sh — deploy the Kahu Ola Worker WITH the read-only SAT_R2 binding.
#
# SAT-1b. The satellite pipeline's bucket name is kept out of the repo. It is
# read from a local config outside the repo:
#     ~/.config/kahuola/sat_r2.env   (chmod 600)   SAT_R2_BUCKET=<name>
# This script copies wrangler.toml into the gitignored .wrangler/ folder,
# appends the binding, and deploys from that copy. A plain `npx wrangler
# deploy` still works but has no SAT_R2 binding, so /api/hazards/smoke-sat
# answers "unavailable" (not_configured) — honest, and nothing else changes.
#
# The Worker only ever calls SAT_R2.get() (see handleSmokeSat /
# handleSmokeSatFrame). Extra wrangler args are passed through, e.g.
#     worker/scripts/deploy.sh --dry-run --outdir /tmp/out
set -euo pipefail
cd "$(dirname "$0")/.."
CFG="${SAT_R2_CONFIG:-$HOME/.config/kahuola/sat_r2.env}"
[ -f "$CFG" ] || { echo "deploy.sh: $CFG not found (SAT_R2_BUCKET=<name>)" >&2; exit 1; }
BUCKET="$(grep -E '^SAT_R2_BUCKET=' "$CFG" | head -1 | cut -d= -f2- | tr -d '[:space:]"'"'")"
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || { echo "deploy.sh: SAT_R2_BUCKET missing or not a valid bucket name" >&2; exit 1; }
mkdir -p .wrangler
OUT=".wrangler/deploy.toml"
# The copy lives one folder down, and wrangler resolves `main` relative to the
# config file, so point it back at src/.
sed -E 's#^main = "src/#main = "../src/#' wrangler.toml > "$OUT"
grep -q '^main = "../src/' "$OUT" || { echo "deploy.sh: could not rewrite main in $OUT" >&2; exit 1; }
printf '\n# Added by scripts/deploy.sh (not committed).\n[[r2_buckets]]\nbinding = "SAT_R2"\nbucket_name = "%s"\n' "$BUCKET" >> "$OUT"
npx wrangler deploy -c "$OUT" "$@"
