#!/usr/bin/env bash
# Wedisense deploy — runs ON THE VPS, invoked by GitHub Actions
# (.github/workflows/ci-cd.yml) after CI passes.
#
# One script serves both environments, selected by DEPLOY_ENV:
#   production (default)  branch main     /var/www/wedisense           API :4100
#   staging               branch staging  /var/www/wedisense-staging   API :4110
#
# Requirements on the VPS:
#   - Node.js >= 20.6 (for --env-file), pnpm >= 9, pm2, git
#   - Repo cloned at the environment's directory with origin pointing to GitHub
#   - apps/api/.env and apps/web/.env.local filled in for that environment
set -euo pipefail

export DEPLOY_ENV="${DEPLOY_ENV:-production}"

case "$DEPLOY_ENV" in
  production)
    DEFAULT_BRANCH="main"
    DEFAULT_HEALTH_URL="http://localhost:4100/api/health"
    PM2_API_NAME="wedisense-api"
    ;;
  staging)
    DEFAULT_BRANCH="staging"
    DEFAULT_HEALTH_URL="http://localhost:4110/api/health"
    PM2_API_NAME="wedisense-api-staging"
    ;;
  *)
    echo "!!! Unknown DEPLOY_ENV '$DEPLOY_ENV' (expected: production | staging)" >&2
    exit 1
    ;;
esac

BRANCH="${DEPLOY_BRANCH:-$DEFAULT_BRANCH}"
HEALTH_URL="${HEALTH_URL:-$DEFAULT_HEALTH_URL}"

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"

# ── Cross-environment guards ───────────────────────────────────────────────
# Both environments live on the same VPS and share PM2, Postgres and Redis.
# Refuse to continue when the directory or database does not match
# DEPLOY_ENV — a mix-up here would reload production processes from staging
# code, or run staging migrations against the production database.
if [[ "$DEPLOY_ENV" == "staging" && "$APP_DIR" != *-staging ]]; then
  echo "!!! DEPLOY_ENV=staging but $APP_DIR is not a staging checkout" >&2
  exit 1
fi
if [[ "$DEPLOY_ENV" == "production" && "$APP_DIR" == *-staging ]]; then
  echo "!!! $APP_DIR is a staging checkout — run with DEPLOY_ENV=staging" >&2
  exit 1
fi
if [[ ! -f apps/api/.env ]]; then
  echo "!!! apps/api/.env is missing in $APP_DIR" >&2
  exit 1
fi
if [[ "$DEPLOY_ENV" == "staging" ]]; then
  if grep -Eq '^DATABASE_URL=.*wedisense_prod' apps/api/.env; then
    echo "!!! Staging apps/api/.env points at the production database" >&2
    exit 1
  fi
  if ! grep -Eq '^REDIS_URL=.*/[1-9][0-9]*"?$' apps/api/.env; then
    echo "!!! Staging REDIS_URL must select a non-zero Redis DB (production uses db 0)" >&2
    exit 1
  fi
fi

echo "==> Deploying $DEPLOY_ENV from branch: $BRANCH ($APP_DIR)"
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

echo "==> Reloading PM2 processes ($DEPLOY_ENV)"
pm2 startOrReload ecosystem.config.cjs
pm2 save

echo "==> Waiting for API health check"
for i in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" > /dev/null 2>&1; then
    echo "==> API healthy — $DEPLOY_ENV deploy complete"
    exit 0
  fi
  sleep 2
done

echo "!!! API failed health check at $HEALTH_URL after 30s" >&2
pm2 logs "$PM2_API_NAME" --lines 30 --nostream || true
exit 1
