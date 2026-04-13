# Prisma workflow for Wedisense AMS

## Adding a new table
1. Edit `apps/api/prisma/schema.prisma`
2. Run: `pnpm --filter api prisma migrate dev --name add_{table_name}`
3. Run: `pnpm --filter api prisma generate`
4. Add seed data in `apps/api/prisma/seed.ts`
5. If table is append-only (like audit_logs): add REVOKE statement to migration SQL

## Adding a column to existing table
Same as above. Ensure nullable or has default to avoid locking migration on large tables.

## Append-only tables (NEVER UPDATE/DELETE)
- audit_logs
- asset_movements
After creating these tables in migration, add:
```sql
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
REVOKE UPDATE, DELETE ON asset_movements FROM PUBLIC;
GRANT INSERT, SELECT ON audit_logs TO wedison_api;
GRANT INSERT, SELECT ON asset_movements TO wedison_api;
```

## Required indexes pattern
Every table must have indexes on: FK columns, status/enum columns, date columns used by jobs.
