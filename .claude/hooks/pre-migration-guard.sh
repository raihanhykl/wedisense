#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Block raw SQL migration execution
if echo "$CMD" | grep -qiE 'psql.*<.*\.sql|prisma migrate deploy'; then
  echo "BLOCKED: Use 'pnpm --filter api prisma migrate dev --name <name>' for migrations. Deploy is for CI only." >&2
  exit 2
fi

# Block direct editing of migration SQL via bash
if echo "$CMD" | grep -qiE '(cat|echo|sed|awk).*prisma/migrations/'; then
  echo "BLOCKED: Do not modify migration files directly." >&2
  exit 2
fi

exit 0
