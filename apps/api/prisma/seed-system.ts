/**
 * System bootstrap seed — safe to run in any environment, including
 * production. Idempotent: permissions, roles, role-permission matrix,
 * locations, asset categories, label templates, and onboarding tours.
 *
 * Mutable descriptive fields (e.g. role.description, category metadata)
 * are propagated on re-run so seed definitions remain the source of
 * truth. Identity fields (codes, names used as natural keys) are
 * never overwritten.
 *
 * Does NOT seed users, assets, movements, vendors, or any data that
 * would pollute a production database. See `seed-demo.ts` for those.
 *
 * Invoked via the `seed.ts` orchestrator — not standalone.
 */

import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

export interface SystemSeedResult {
  permissions: Record<string, string>;
  roles: Record<string, string>;
  locationMap: Record<string, string>;
  categories: Record<string, string>;
  /**
   * Reports the outcome of the optional first-admin bootstrap step:
   *   - 'skipped-has-users': DB already had ≥1 user; bootstrap did nothing.
   *   - 'skipped-no-env':    No users in DB, but BOOTSTRAP_ADMIN_* env vars
   *                          were missing. Operator must set them and re-run.
   *   - 'created':           A SUPER_ADMIN user was created from env vars.
   *                          Operator should login + rotate password.
   */
  adminBootstrap: 'skipped-has-users' | 'skipped-no-env' | 'created';
}

export async function seedSystem(prisma: PrismaClient): Promise<SystemSeedResult> {
  // ─── 1. Permissions ──────────────────────────────────────────────────────
  console.log('Creating permissions...');

  const permissionDefs = [
    { resource: 'assets', action: 'create' },
    { resource: 'assets', action: 'read' },
    { resource: 'assets', action: 'update' },
    { resource: 'assets', action: 'delete' },
    { resource: 'assets', action: 'export' },
    { resource: 'assets', action: 'import' },
    { resource: 'assets', action: 'print' },
    { resource: 'movements', action: 'create' },
    { resource: 'movements', action: 'approve' },
    { resource: 'maintenance', action: 'manage' },
    { resource: 'reports', action: 'view' },
    { resource: 'reports', action: 'generate' },
    { resource: 'users', action: 'manage' },
    // Phase 17 v2 — admin-driven password reset. Separated from
    // `users:manage` because it's strictly more dangerous (write the
    // session of any account) and we want it gated to SUPER_ADMIN only,
    // even though ADMIN has broad user-management rights.
    { resource: 'users', action: 'reset-password' },
    { resource: 'roles', action: 'manage' },
    { resource: 'audit', action: 'read' },
    { resource: 'labels', action: 'manage' },
    { resource: 'tours', action: 'manage' },
    { resource: 'categories', action: 'manage' },
    // Phase 17 — procurement batch tracking. Separate resource for
    // PurchaseOrder (commercial layer) and ProcurementBatch (receipt
    // layer) so location-scoped roles can be granted one without the
    // other if needed later.
    { resource: 'purchase-orders', action: 'read' },
    { resource: 'purchase-orders', action: 'create' },
    { resource: 'purchase-orders', action: 'update' },
    { resource: 'purchase-orders', action: 'close' },
    { resource: 'purchase-orders', action: 'cancel' },
    { resource: 'procurement', action: 'read' },
    { resource: 'procurement', action: 'create' },
    { resource: 'procurement', action: 'update' },
    { resource: 'procurement', action: 'complete' },
    { resource: 'procurement', action: 'cancel' },
    // RESERVED — no router currently gates on `procurement:export`.
    // Frontend's MANAGER preset grants it in anticipation of the future
    // procurement export endpoint (planned Phase 12). Kept here so the
    // grant exists when the endpoint ships, rather than retroactively
    // patching every MANAGER role's permission set later.
    { resource: 'procurement', action: 'export' },
    // Phase 17 v2 — vendor registry. read+create granted broadly so the
    // PO form's inline autocomplete + "save new" can work; update/delete
    // gated to the vendor admin page.
    { resource: 'vendors', action: 'read' },
    { resource: 'vendors', action: 'create' },
    { resource: 'vendors', action: 'update' },
    { resource: 'vendors', action: 'delete' },
  ];

  const permissions: Record<string, string> = {};
  for (const perm of permissionDefs) {
    const result = await prisma.permission.upsert({
      where: { resource_action: { resource: perm.resource, action: perm.action } },
      update: {},
      create: {
        id: crypto.randomUUID(),
        resource: perm.resource,
        action: perm.action,
      },
    });
    permissions[`${perm.resource}:${perm.action}`] = result.id;
  }
  console.log(`  ✓ ${Object.keys(permissions).length} permissions`);

  // ─── 2+3. Roles + Role-Permission matrix ─────────────────────────────────
  // Coupled in one transaction per role so a role never exists in the DB
  // without its expected permission set. Partial state (role created, but
  // permissions not yet assigned) would let users authenticate against a
  // role with zero permissions until the next seed run — confusing, and
  // worse, possibly invisible (login still works, only specific actions
  // mysteriously 403).
  console.log('Creating roles + permission matrix (per-role transactions)...');

  const roleDefs = [
    { name: 'SUPER_ADMIN', description: 'Full system access with all permissions' },
    { name: 'ADMIN', description: 'Administrative access without role management' },
    { name: 'MANAGER', description: 'Asset and operations management' },
    { name: 'STAFF', description: 'Basic asset operations' },
    { name: 'VIEWER', description: 'Read-only access' },
  ];

  const allPermKeys = Object.keys(permissions);

  const rolePermissionMatrix: Record<string, string[]> = {
    SUPER_ADMIN: allPermKeys,
    // ADMIN gets everything EXCEPT role management AND password reset.
    // Password reset is intentionally SUPER_ADMIN-only — even broad
    // user-admin shouldn't be able to take over arbitrary sessions.
    ADMIN: allPermKeys.filter((k) => k !== 'roles:manage' && k !== 'users:reset-password'),
    MANAGER: [
      'assets:create',
      'assets:read',
      'assets:update',
      'assets:export',
      'assets:print',
      'movements:create',
      'movements:approve',
      'maintenance:manage',
      'reports:view',
      'reports:generate',
      // Phase 17 procurement: MANAGER drives day-to-day pengadaan but
      // cannot cancel a PO (that's a financial/admin call).
      'purchase-orders:read',
      'purchase-orders:create',
      'purchase-orders:update',
      'procurement:read',
      'procurement:create',
      'procurement:update',
      'procurement:complete',
      'procurement:export',
      // Vendor: MANAGER can read + quick-save during PO creation. Full
      // edit + delete stays with ADMIN.
      'vendors:read',
      'vendors:create',
    ],
    STAFF: [
      'assets:read',
      'assets:print',
      'movements:create',
      'reports:view',
      'purchase-orders:read',
      'procurement:read',
      'vendors:read',
    ],
    VIEWER: [
      'assets:read',
      'reports:view',
      'purchase-orders:read',
      'procurement:read',
      'vendors:read',
    ],
  };

  // Validate the entire matrix references known permissions BEFORE we
  // open any transaction. Fail-fast keeps every per-role tx atomic and
  // avoids leaving partial state behind on bad matrix edits.
  for (const [roleName, permKeys] of Object.entries(rolePermissionMatrix)) {
    for (const permKey of permKeys) {
      if (!permissions[permKey]) {
        throw new Error(
          `Permission "${permKey}" referenced in ${roleName} matrix but not in permissionDefs`,
        );
      }
    }
  }

  const roles: Record<string, string> = {};
  for (const roleDef of roleDefs) {
    const permKeys = rolePermissionMatrix[roleDef.name];
    if (!permKeys) {
      throw new Error(`Role ${roleDef.name} has no entry in rolePermissionMatrix`);
    }

    // Per-role transaction: role row + its full permission set as one
    // unit. Default timeout (5s) is plenty — at most ~35 RolePermission
    // upserts per role.
    const roleId = await prisma.$transaction(async (tx) => {
      const role = await tx.role.upsert({
        where: { name: roleDef.name },
        // Description is mutable seed-of-truth — propagate on re-run.
        update: { description: roleDef.description, isSystem: true },
        create: {
          id: crypto.randomUUID(),
          name: roleDef.name,
          description: roleDef.description,
          isSystem: true,
        },
      });

      for (const permKey of permKeys) {
        await tx.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permissions[permKey]!,
            },
          },
          update: {},
          create: { roleId: role.id, permissionId: permissions[permKey]! },
        });
      }

      return role.id;
    });

    roles[roleDef.name] = roleId;
  }
  console.log(`  ✓ ${Object.keys(roles).length} roles + permission matrix`);

  // ─── 4. Locations ────────────────────────────────────────────────────────
  console.log('Creating locations...');

  const locPI = await prisma.location.upsert({
    where: { code: 'PI-JKT' },
    update: {
      name: 'Pondok Indah, Jakarta Selatan',
      address: 'Jl. Sultan Iskandar Muda No 30 A-C',
      city: 'Jakarta Selatan',
      province: 'DKI Jakarta',
    },
    create: {
      id: crypto.randomUUID(),
      name: 'Pondok Indah, Jakarta Selatan',
      code: 'PI-JKT',
      address: 'Jl. Sultan Iskandar Muda No 30 A-C',
      city: 'Jakarta Selatan',
      province: 'DKI Jakarta',
      type: 'HEAD_OFFICE',
    },
  });

  const locPIChildren = [
    { name: 'Head Office Lantai 1', code: 'PI-HO-L1', type: 'HEAD_OFFICE' as const },
    { name: 'Head Office Lantai 2', code: 'PI-HO-L2', type: 'HEAD_OFFICE' as const },
    { name: 'Head Office Lantai 3', code: 'PI-HO-L3', type: 'HEAD_OFFICE' as const },
    { name: 'Head Office Lantai 4', code: 'PI-HO-L4', type: 'HEAD_OFFICE' as const },
    { name: 'Showroom Jakarta', code: 'PI-SR', type: 'SHOWROOM' as const },
    { name: 'Service Center Jakarta', code: 'PI-SC', type: 'SERVICE_CENTER' as const },
  ];

  const locationMap: Record<string, string> = { 'PI-JKT': locPI.id };

  for (const child of locPIChildren) {
    const loc = await prisma.location.upsert({
      where: { code: child.code },
      update: { name: child.name, parentId: locPI.id },
      create: {
        id: crypto.randomUUID(),
        name: child.name,
        code: child.code,
        type: child.type,
        parentId: locPI.id,
        city: 'Jakarta Selatan',
        province: 'DKI Jakarta',
      },
    });
    locationMap[child.code] = loc.id;
  }

  const locGB = await prisma.location.upsert({
    where: { code: 'GB-BDG' },
    update: {
      name: 'Gadobangkong, Bandung',
      address: 'Jl. Gadobangkong',
      city: 'Bandung',
      province: 'Jawa Barat',
    },
    create: {
      id: crypto.randomUUID(),
      name: 'Gadobangkong, Bandung',
      code: 'GB-BDG',
      address: 'Jl. Gadobangkong',
      city: 'Bandung',
      province: 'Jawa Barat',
      type: 'BRANCH',
    },
  });
  locationMap['GB-BDG'] = locGB.id;

  const locGBChildren = [
    { name: 'Showroom Bandung', code: 'GB-SR', type: 'SHOWROOM' as const },
    { name: 'Service Center Bandung', code: 'GB-SC', type: 'SERVICE_CENTER' as const },
  ];

  for (const child of locGBChildren) {
    const loc = await prisma.location.upsert({
      where: { code: child.code },
      update: { name: child.name, parentId: locGB.id },
      create: {
        id: crypto.randomUUID(),
        name: child.name,
        code: child.code,
        type: child.type,
        parentId: locGB.id,
        city: 'Bandung',
        province: 'Jawa Barat',
      },
    });
    locationMap[child.code] = loc.id;
  }
  console.log(`  ✓ ${Object.keys(locationMap).length} locations`);

  // ─── 5. Asset Categories ─────────────────────────────────────────────────
  console.log('Creating asset categories...');

  const categoryDefs = [
    {
      name: 'IT Equipment',
      code: 'IT',
      icon: 'monitor',
      color: '#3B82F6',
      depreciationMethod: 'STRAIGHT_LINE' as const,
      defaultUsefulLifeMonths: 36,
    },
    {
      name: 'Furniture',
      code: 'FRN',
      icon: 'armchair',
      color: '#8B5CF6',
      depreciationMethod: 'STRAIGHT_LINE' as const,
      defaultUsefulLifeMonths: 60,
    },
    {
      name: 'Vehicles',
      code: 'VHC',
      icon: 'car',
      color: '#EF4444',
      depreciationMethod: 'DECLINING_BALANCE' as const,
      defaultDepreciationRate: 25,
      defaultUsefulLifeMonths: 60,
    },
    {
      name: 'Office Supplies',
      code: 'OFS',
      icon: 'package',
      color: '#10B981',
      depreciationMethod: 'NONE' as const,
    },
    {
      name: 'Electronics',
      code: 'ELC',
      icon: 'cpu',
      color: '#F59E0B',
      depreciationMethod: 'STRAIGHT_LINE' as const,
      defaultUsefulLifeMonths: 24,
    },
  ];

  const categories: Record<string, string> = {};
  for (const cat of categoryDefs) {
    const result = await prisma.assetCategory.upsert({
      where: { code: cat.code },
      update: {
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        depreciationMethod: cat.depreciationMethod,
        defaultDepreciationRate: cat.defaultDepreciationRate ?? null,
        defaultUsefulLifeMonths: cat.defaultUsefulLifeMonths ?? null,
      },
      create: {
        id: crypto.randomUUID(),
        name: cat.name,
        code: cat.code,
        icon: cat.icon,
        color: cat.color,
        depreciationMethod: cat.depreciationMethod,
        defaultDepreciationRate: cat.defaultDepreciationRate ?? null,
        defaultUsefulLifeMonths: cat.defaultUsefulLifeMonths ?? null,
      },
    });
    categories[cat.code] = result.id;
  }
  console.log(`  ✓ ${Object.keys(categories).length} asset categories`);

  // ─── 6. First-admin bootstrap (production-critical) ──────────────────────
  const adminBootstrap = await bootstrapAdminIfNeeded(prisma, roles);

  return { permissions, roles, locationMap, categories, adminBootstrap };
}

/**
 * Optional first-admin bootstrap. Solves the chicken-and-egg problem of
 * fresh production deployments: the system-seed creates roles +
 * permissions, but with no user there's nobody to log in and manage
 * anything. This step optionally creates a single SUPER_ADMIN user from
 * env vars, but ONLY when the user table is empty.
 *
 * Idempotency rules:
 *   - If ANY user exists in the DB → skip entirely. Re-running seed
 *     after the first admin has been created (or after users have been
 *     invited via the admin UI) never touches user data.
 *   - If no users exist but env vars are missing → log a warning and
 *     skip. Operator must set BOOTSTRAP_ADMIN_EMAIL and
 *     BOOTSTRAP_ADMIN_PASSWORD then re-run.
 *
 * Why env vars (not interactive prompt or static seed value):
 *   - Source code never contains a real password.
 *   - CI/CD can pipe a freshly-generated secret straight from a secret
 *     manager into the seed run, then drop it from the env afterwards.
 *   - Re-runs are safe by default (the env var stops being honored as
 *     soon as any user exists).
 *
 * Operator flow on first prod deploy:
 *   1. Generate a strong random password (e.g. `openssl rand -base64 24`)
 *   2. Set BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD in env
 *   3. Run `NODE_ENV=production ALLOW_PROD_SEED=true pnpm prisma:seed`
 *   4. Login with that admin, rotate the password via UI
 *   5. Remove BOOTSTRAP_ADMIN_PASSWORD from env (no longer used)
 *   6. Invite other users via the user-management UI
 */
async function bootstrapAdminIfNeeded(
  prisma: PrismaClient,
  roles: Record<string, string>,
): Promise<SystemSeedResult['adminBootstrap']> {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return 'skipped-has-users';
  }

  const email = process.env['BOOTSTRAP_ADMIN_EMAIL'];
  const password = process.env['BOOTSTRAP_ADMIN_PASSWORD'];
  const name = process.env['BOOTSTRAP_ADMIN_NAME'] ?? 'Administrator';
  // employeeId is required in the schema. Use a sentinel value that's
  // recognizable as bootstrap-origin so an admin can find + update it
  // via the UI later (e.g. set to a real employee number).
  const employeeId = process.env['BOOTSTRAP_ADMIN_EMPLOYEE_ID'] ?? 'BOOTSTRAP';

  if (!email || !password) {
    console.log('\n⚠️  No users in DB — bootstrap admin step.');
    console.log(
      '   Set BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD (and optionally\n' +
        '   BOOTSTRAP_ADMIN_NAME) to create the first SUPER_ADMIN user, then\n' +
        '   re-run the seed. Without an admin, nobody can log in to the app.',
    );
    return 'skipped-no-env';
  }

  if (password.length < 12) {
    throw new Error(
      'BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters. ' +
        'This account has full system access — a weak password here is a ' +
        'critical risk. Generate one with: openssl rand -base64 24',
    );
  }

  const superAdminRoleId = roles['SUPER_ADMIN'];
  if (!superAdminRoleId) {
    throw new Error(
      'Cannot bootstrap admin: SUPER_ADMIN role not found in roles map. ' +
        'This should never happen — the seed creates this role earlier.',
    );
  }

  console.log('\nBootstrapping first admin user...');
  const passwordHash = await bcrypt.hash(password, 12);

  // Atomic: user + SUPER_ADMIN role assignment must land together.
  // Identical pattern to the demo-user transaction so the user is never
  // left without any role (which would be a silent permission-deny state).
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        id: crypto.randomUUID(),
        name,
        email: email.toLowerCase().trim(),
        passwordHash,
        employeeId,
        status: 'ACTIVE',
      },
    });
    await tx.userRole.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        roleId: superAdminRoleId,
        locationId: null, // Global scope — SUPER_ADMIN sees everything.
      },
    });
  });

  console.log(`  ✓ Created SUPER_ADMIN: ${email}`);
  console.log(
    '\n  ⚠️  Login + rotate this password immediately via the UI.\n' +
      '     Then unset BOOTSTRAP_ADMIN_PASSWORD in the environment.',
  );

  return 'created';
}
