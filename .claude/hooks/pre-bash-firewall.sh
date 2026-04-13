#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Block destructive DB commands
if echo "$CMD" | grep -qiE 'prisma migrate reset|DROP DATABASE|DROP TABLE'; then
  echo "BLOCKED: Destructive database command requires explicit human approval. Ask first." >&2
  exit 2
fi

# Block accidental production env usage
if echo "$CMD" | grep -qE 'NODE_ENV=production'; then
  echo "BLOCKED: Do not run production commands from Claude Code sessions." >&2
  exit 2
fi

# Block rm -rf on source directories
if echo "$CMD" | grep -qE 'rm -rf (apps|packages|src|prisma)/'; then
  echo "BLOCKED: Destructive rm on source directories is not allowed." >&2
  exit 2
fi

exit 0
