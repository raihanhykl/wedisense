# Wedisense AMS — Project Memory

## What this project is
Web-based Asset Management System (Wedisense) for Wedison (Indonesia).
Monorepo: `apps/api` (Express.js + Prisma + PostgreSQL), `apps/web` (Next.js 14 + React 18 + shadcn/ui), `packages/shared`.
See @README.md for full overview. See @wedisense-ams-claude-code-prompt.md for complete spec.

## Package manager
YOU MUST use `pnpm` for everything. Never use npm or yarn.
- Install: `pnpm install`
- Run api: `pnpm --filter api dev`
- Run web: `pnpm --filter web dev`
- Run all: `pnpm dev` (from root, uses concurrently)

## Build & type check
- Typecheck api: `pnpm --filter api typecheck`
- Typecheck web: `pnpm --filter web typecheck`
- Lint all: `pnpm lint`
- Test api: `pnpm --filter api test`
Run typecheck + lint after every series of edits. Fix all errors before stopping.

## Database (Prisma)
- Never edit migration files directly — always use `pnpm --filter api prisma migrate dev`
- Never run `prisma migrate reset` without my explicit approval
- After schema changes: regenerate client with `pnpm --filter api prisma generate`
- See @apps/api/prisma/schema.prisma for full schema

## Code rules
- TypeScript strict mode. No `any`. No `// @ts-ignore` without written reason in the same line.
- All async route handlers wrapped in `asyncHandler()` utility — never raw try/catch in routers
- All multi-table writes use `prisma.$transaction()` — no exceptions
- No hardcoded strings in any language — use i18n keys. See @packages/shared/locales/
- audit_logs and asset_movements are append-only — NEVER write UPDATE or DELETE on these tables

## File protection
IMPORTANT: Never edit these files without my explicit approval:
- `apps/api/prisma/migrations/**` (use migrate dev instead)
- `.env`, `.env.*` (read only)
- `packages/shared/locales/**` (always update both en + id simultaneously)

## When compacting
Preserve: list of modified files, current migration state, open decisions awaiting my review.

## Global skills available
Installed at ~/.claude/skills/ and available on demand:
- superpowers-test-driven-development — TDD workflow
- superpowers-writing-plans — structured planning
- superpowers-executing-plans — plan execution with checkpoints
- superpowers-systematic-debugging — structured debugging
- superpowers-verification-before-completion — verify before claiming done
- superpowers-dispatching-parallel-agents — parallel agent dispatch
- superpowers-using-git-worktrees — git worktree isolation
- superpowers-requesting-code-review — request code review
- superpowers-receiving-code-review — receive code review feedback
- github-pr-review — GitHub PR review workflow
- handoff — session handoff documents
- skill-creator — create new skills

Relevant project skills: @.claude/skills/prisma-workflow.md, @.claude/skills/api-conventions.md,
@.claude/skills/movement-rules.md, @.claude/skills/tour-sync-rules.md

## Agent routing
For tasks spanning frontend + backend + DB simultaneously → use agent team (see @.claude/agents/)
For quick isolated tasks → use subagents via Task tool
For single-domain work → work directly in main session
