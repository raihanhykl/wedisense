#!/usr/bin/env bash
# Wedisense production deploy — runs ON THE VPS, invoked by GitHub Actions
# (.github/workflows/ci-cd.yml) after CI passes on main.
#
# Requirements on the VPS:
#   - Node.js >= 20.6 (for --env-file), pnpm >= 9, pm2, git
#   - Repo cloned at $APP_DIR with origin pointing to GitHub
#   - apps/api/.env and apps/web/.env.local filled in
set -euo pipefail

BRANCH="${DEPLOY_BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://localhost:4100/api/health}"

cd "$(dirname "$0")/.."

echo "==> Deploying branch: $BRANCH"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
echo "==> Now at $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

echo "==> Installing dependencies"
pnpm install --frozen-lockfile

echo "==> Applying database migrations"
pnpm --filter api exec prisma migrate deploy

echo "==> Generating Prisma client"
pnpm --filter api exec prisma generate

echo "==> Building (shared, api, web)"
pnpm build

echo "==> Reloading PM2 processes"
# --update-env: without it PM2 keeps the env/args a process was first
# started with and silently ignores ecosystem changes on reload.
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "==> Waiting for API health check"
for i in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" > /dev/null 2>&1; then
    echo "==> API healthy — deploy complete"
    exit 0
  fi
  sleep 2
done

echo "!!! API failed health check at $HEALTH_URL after 30s" >&2
pm2 logs wedisense-api --lines 30 --nostream || true
exit 1
