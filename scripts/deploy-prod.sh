#!/usr/bin/env bash
# Production deploy to the v2 project (cruise.dude.work). The original `we-are-on-the-cruise` project and its
# production stay untouched. Deploys a clean export of HEAD (never the working tree), then verify with the Vercel API.
#   scripts/deploy-prod.sh
set -euo pipefail
PROJECT="${CRUISE_PROD_PROJECT:-cruise-dude-work}"
SCOPE="${CRUISE_VERCEL_SCOPE:-amirs-projects-d9680079}"
OUT="${CRUISE_PROD_EXPORT:-/tmp/cruise-prod}"
rm -rf "$OUT"; mkdir -p "$OUT"
git archive HEAD | tar -x -C "$OUT"
echo "exported $(git rev-parse --short HEAD) to $OUT"
cd "$OUT"
npx -y vercel@latest link --yes --project "$PROJECT" --scope "$SCOPE" >/dev/null
npx -y vercel@latest deploy --prod --yes --scope "$SCOPE"
