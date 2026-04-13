#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Block direct edits to migration files
if echo "$FILE" | grep -qE 'prisma/migrations/'; then
  echo "BLOCKED: Do not edit migration files directly. Use: pnpm --filter api prisma migrate dev --name <name>" >&2
  exit 2
fi

# Block edits to .env files
if echo "$FILE" | grep -qE '\.env(\.|$)'; then
  echo "BLOCKED: Do not edit .env files. Update .env.example and ask the human to update .env manually." >&2
  exit 2
fi

exit 0
