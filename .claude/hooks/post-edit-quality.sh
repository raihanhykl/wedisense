#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Determine which app was edited
if echo "$FILE" | grep -q 'apps/api/'; then
  cd "$CLAUDE_PROJECT_DIR"
  if ! pnpm --filter api typecheck 2>&1 | tail -5; then
    echo "TypeScript errors in API. Fix before continuing." >&2
  fi
elif echo "$FILE" | grep -q 'apps/web/'; then
  cd "$CLAUDE_PROJECT_DIR"
  if ! pnpm --filter web typecheck 2>&1 | tail -5; then
    echo "TypeScript errors in Web. Fix before continuing." >&2
  fi
fi

exit 0
