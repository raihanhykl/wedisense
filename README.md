# Wedisense — Asset Management System

Web-based Asset Management System for **Wedison**, built to manage all office assets across multiple locations in Indonesia.

## Tech Stack

- **Backend**: Express.js + TypeScript + Prisma + PostgreSQL
- **Frontend**: Next.js 14 (App Router) + React 18 + shadcn/ui + Tailwind CSS
- **Queue**: BullMQ + Redis
- **Monorepo**: pnpm workspaces

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0
- **PostgreSQL** 15+
- **Redis** 7+

## Setup

### 1. Clone & install dependencies

```bash
git clone <repo-url>
cd wedisense
pnpm install
```

### 2. Configure environment

```bash
# Root level
cp .env.example .env

# API
cp apps/api/.env.example apps/api/.env

# Web
cp apps/web/.env.example apps/web/.env.local
```

Edit each `.env` file with your local configuration.

### 3. Set up the database

```bash
# Create the database
createdb wedisense_dev

# Run migrations
pnpm --filter api prisma migrate dev

# Generate Prisma client
pnpm --filter api prisma generate

# Seed the database
pnpm --filter api prisma:seed
```

### 4. Start development servers

```bash
# Start both API and Web concurrently
pnpm dev

# Or individually:
pnpm --filter api dev    # API on http://localhost:4000
pnpm --filter web dev    # Web on http://localhost:3000
```

## Project Structure

```
wedisense/
├── apps/
│   ├── api/              # Express.js API server
│   │   ├── src/
│   │   │   ├── modules/  # Feature modules (router/service/repository)
│   │   │   ├── middleware/
│   │   │   ├── lib/      # Prisma, Redis, storage adapters
│   │   │   ├── utils/    # Helpers (pagination, diff, async-handler)
│   │   │   ├── jobs/     # BullMQ background jobs
│   │   │   ├── app.ts
│   │   │   └── server.ts
│   │   └── prisma/       # Schema, migrations, seed
│   └── web/              # Next.js 14 frontend
│       └── src/
│           ├── app/      # App Router pages
│           ├── components/
│           ├── hooks/
│           ├── stores/
│           └── lib/
├── packages/
│   └── shared/           # Shared types, constants, schemas, locales
│       ├── src/
│       └── locales/      # i18n (en, id)
├── CLAUDE.md             # AI workspace memory
└── .claude/              # AI agents, skills, hooks
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start all dev servers |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm --filter api test` | Run API tests |
| `pnpm --filter api prisma studio` | Open Prisma Studio |

## Environment Variables

See [`.env.example`](.env.example) for all required variables with descriptions.

## License

Private — Wedison internal use only.
