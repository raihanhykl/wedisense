# Audit-log convention

> **Audience:** anyone adding or modifying a mutating endpoint in `apps/api`.
> **TL;DR:** audit happens inline in service code, inside the same
> transaction that does the write. There is no middleware. The
> `audit-coverage` test will fail your build until you've inventoried any
> new mutating route and either added an audit-log call or written a
> "skipped" reason.

---

## 1. Why inline (not middleware)

A response-cycle middleware that scrapes the request and writes `audit_logs`
is the obvious-looking solution, but we deliberately don't use it. Three
reasons:

1. **Transaction scope.** A movement creation writes to `assets`,
   `asset_movements`, and `audit_logs` atomically. Middleware lives outside
   the service transaction, so a service rollback would leave a stale
   audit row pointing at a write that never landed. Inline `tx.auditLog.create(...)`
   inside the `prisma.$transaction(async (tx) => ...)` block solves this for
   free.

2. **Diff specificity.** Audit rows store `oldValues` and `newValues` as the
   *changed* subset of fields, not the entire entity. A middleware that
   diffs request body vs response body picks up too much noise (server
   defaults, timestamps, joined relations). Inline code knows exactly which
   fields changed and writes only those.

3. **Sensitive-field redaction.** Password changes record `{ passwordChanged: true }`,
   not the new hash. Permission edits redact certain joined data. A
   middleware would either log too much or need module-specific configuration
   that duplicates the inline approach.

## 2. The shape of an audit entry

```ts
await prisma.auditLog.create({
  data: {
    userId,                           // who did it (the actor — NOT the resource owner)
    action,                           // CREATE | UPDATE | DELETE | LOGIN | LOGOUT
                                      // | EXPORT | IMPORT | PRINT | APPROVE | REJECT
    resourceType,                     // 'Asset', 'User', 'OnboardingTour', etc.
    resourceId,                       // PK of the affected row (or 'bulk' for batches)
    oldValues: { ... },               // optional; only changed fields, before
    newValues: { ... },               // optional; only changed fields, after
    ipAddress: ctx.ipAddress,         // optional; from req.ip in auth flows
    userAgent: ctx.userAgent,         // optional; from req.headers['user-agent']
  },
});
```

Fields that are `undefined` should be omitted, not set to `null`, to keep
the table clean. Use spread guards:

```ts
...(ctx.ipAddress !== undefined && { ipAddress: ctx.ipAddress }),
```

## 3. Patterns by complexity

### 3a. Simple single-write (the common case)

```ts
export async function createCategory(input: CreateCategoryInput, userId: string) {
  return prisma.$transaction(async (tx) => {
    const category = await tx.assetCategory.create({ data: { ... } });
    await tx.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resourceType: 'AssetCategory',
        resourceId: category.id,
        newValues: { name: category.name, code: category.code },
      },
    });
    return category;
  });
}
```

The audit goes inside the `$transaction` callback so a failure on either
side rolls back the other.

### 3b. Update with diff

For `UPDATE` actions, compute the diff before writing. The diff should be
the changed fields only — comparing entire entities makes the audit row
noisy and bloats the JSONB column.

```ts
const before = await tx.user.findUnique({ where: { id }, select: { name: true, email: true } });
const updated = await tx.user.update({ where: { id }, data: input });
const changedFields = Object.keys(input).filter((k) => before[k] !== updated[k]);
const oldValues = Object.fromEntries(changedFields.map((k) => [k, before[k]]));
const newValues = Object.fromEntries(changedFields.map((k) => [k, updated[k]]));
await tx.auditLog.create({
  data: { userId: actorId, action: 'UPDATE', resourceType: 'User', resourceId: id, oldValues, newValues },
});
```

If you find yourself diffing the same shape in multiple places, extract a
helper into the module — see `apps/api/src/modules/movements/service.ts:createAuditLog`
for the canonical shape.

### 3c. Bulk operations

For bulk endpoints (`POST /api/assets/bulk-move-location` etc.) write one
audit row PER affected resource, not one summary row. Compliance reviewers
need to be able to filter by `resourceId` and see every event that touched
a specific asset.

The exception is `EXPORT` and `IMPORT`: these get a single summary row
with `resourceId: 'bulk'` and `newValues: { filters, count }` because the
affected resource is the export/import operation itself, not the
individual rows.

### 3d. Auth flows (LOGIN / LOGOUT / password change)

Auth audits are best-effort: they should not fail the user's primary
action. Wrap the audit call in try/catch and log to console on failure:

```ts
try {
  await prisma.auditLog.create({ data: { userId, action: 'LOGIN', ... } });
} catch (err) {
  console.error('[audit] LOGIN write failed', err);
}
```

The login itself has already succeeded by the time we hit the audit
write; a transient DB hiccup must not 500 the user. For `UPDATE` actions
that genuinely change business state (password rotation), keep the audit
inside the transaction — those are not "best-effort".

### 3e. Async / background-job audits

Jobs (BullMQ workers) that mutate data audit through the same service
functions as HTTP handlers when possible, so the audit happens once
inline. When a job has a direct DB write that doesn't go through a
service (e.g. depreciation recalculation), the job itself writes the
audit row with `userId: null` (system action) — see
`apps/api/src/jobs/depreciation.job.ts`.

## 4. Skipping audit on purpose

Some endpoints deliberately skip audit. Each must have a written reason in
`apps/api/src/modules/__tests__/audit-inventory.ts`:

```ts
{
  method: 'PUT',
  path: '/api/notifications/:id/read',
  module: 'notifications',
  decision: skipped(
    "User flipping read flag on their own notification. High-frequency, low compliance value.",
  ),
}
```

Recognised categories of legitimate skip:

- **High-frequency low-value writes** — tour step progress, notification
  read flags. Writing audit on every Next/Prev click would flood the table
  and obscure the meaningful events.
- **Pure read or validation endpoints** — `revalidate-row`, listing,
  detail GETs. No DB write to audit.
- **Artifact downloads** — preview PDFs, error reports. The user is
  pulling a derived file, not mutating state.
- **User's own UI preferences** — saved views. The "resource" is the user's
  client-side state; it doesn't intersect with business data anyone else
  would audit.
- **Cache fills from external APIs** — `POST /api/products/lookup`. The
  new row mirrors public data; user-driven edits still audit via
  `PUT /api/products/:id`.
- **Dev-only endpoints** — `/_dev/trigger/:jobName`. Guarded against
  production; not part of the audit surface.

If you're unsure whether something should audit, lean toward AUDIT. The
table has its own append-only DB constraint and a date-range filter on
the admin UI; a few extra rows are cheaper than a missing compliance trail.

## 5. The coverage test

`apps/api/src/modules/__tests__/audit-coverage.test.ts` runs in CI and
will fail your build if:

- You add a new `router.post|put|patch|delete(...)` declaration without a
  matching entry in `audit-inventory.ts`. The failure message lists the
  exact route(s) to add.
- You remove an inventory entry but leave the route in source (the
  inventory has gone stale).
- An entry says `audited: true, serviceModule: 'X'` but the test can't
  find any audit-write pattern (`auditLog.create`, `createAuditLog`,
  `createAuditLogInTransaction`) in `apps/api/src/modules/X/`.
- An entry says `audited: false` with an empty or trivial `reason`.

The test does NOT verify *which* code path inside the service writes the
audit, so a determined developer could move audit logic into a helper
function that's only called by some routes and the test would still pass.
This is acceptable: the test catches accidental removal and forgotten
inventory entries, which are the regressions that actually happen.

For module-level confidence beyond the static contract, write a Supertest
integration test that fires the route with mocked Prisma and asserts
`auditLog.create` was called — `apps/api/src/modules/tours/router.test.ts`
is the template.

## 6. Append-only constraint

`audit_logs` has `REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC` applied
at the Postgres level (migration `20260413103700_append_only_constraints`).
**Never write `prisma.auditLog.update(...)` or `prisma.auditLog.delete(...)`.**
The Prisma client doesn't enforce this — it'll happily generate the SQL
which Postgres then refuses with an error that's harder to debug than the
intent. If you find yourself wanting to update an audit row, you're
modelling something wrong; write a new row instead.

## 7. Quick reference

| Where audit happens | Where to look |
|---|---|
| Standard service write | `<module>/service.ts` — search for `auditLog.create` |
| Service uses transaction helper | `<module>/service.ts` — search for `createAuditLog(` |
| Service uses repository helper | `<module>/repository.ts` — search for `createAuditLogInTransaction` |
| Auth flows | `auth/service.ts` — `login`, `recordLogout`, `changePassword` |
| Bulk via inline router code | `assets/router.ts` — search for `prisma.auditLog.create` |
| Async job | `jobs/<name>.job.ts` |
