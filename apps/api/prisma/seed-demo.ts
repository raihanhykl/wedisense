/**
 * Demo data seed — fake users, assets, movements, vendors, label
 * templates, onboarding tours, and asset-number sequences seeded to
 * match the demo asset set.
 *
 * IMPORTANT: must NEVER run in production. The `seed.ts` orchestrator
 * gates this behind an environment check and an explicit `SEED_DEMO`
 * flag. Do not import this file from anywhere else.
 *
 * Idempotency notes:
 *   - assetNumberSequence rows are created-only (never updated). On
 *     re-run, existing counter values are preserved so real assets
 *     created in dev between seed runs don't clash with the seed's
 *     hardcoded starting values.
 *   - asset_movements use deterministic per-asset reference numbers
 *     (`SEED-INIT-{assetNumber}`, etc.) instead of a sequential counter
 *     so re-arranging the assetDefs array doesn't shift refs.
 */

import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import type { SystemSeedResult } from './seed-system.js';

/**
 * Generate a URL-safe random password. 16 base64url chars = ~96 bits of
 * entropy — well above any practical brute-force threshold even before
 * bcrypt's cost-12 amplification.
 */
function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * Resolve the password for a demo user. Order of precedence:
 *   1. Per-user env var (`SEED_DEMO_PASSWORD_<EMPLOYEE_ID>`), e.g.
 *      `SEED_DEMO_PASSWORD_EMP001=letmein!` for the super-admin account.
 *   2. Shared env var (`SEED_DEMO_PASSWORD`) for all demo users.
 *   3. Generate a random password and return it for one-time display.
 *
 * Returns `{ password, source }` so the orchestrator knows whether to
 * print credentials to stdout (random-only — env-provided passwords
 * are presumed already known to the operator).
 */
function resolvePassword(employeeId: string): {
  password: string;
  source: 'env-user' | 'env-shared' | 'random';
} {
  const userSpecific = process.env[`SEED_DEMO_PASSWORD_${employeeId}`];
  if (userSpecific && userSpecific.length >= 8) {
    return { password: userSpecific, source: 'env-user' };
  }
  const shared = process.env['SEED_DEMO_PASSWORD'];
  if (shared && shared.length >= 8) {
    return { password: shared, source: 'env-shared' };
  }
  return { password: generatePassword(), source: 'random' };
}

export interface SeedDemoResult {
  /** Maps employeeId → { email, password, source } for one-time display. */
  credentials: Array<{
    employeeId: string;
    email: string;
    password: string;
    source: 'env-user' | 'env-shared' | 'random';
  }>;
}

export async function seedDemo(
  prisma: PrismaClient,
  system: SystemSeedResult,
): Promise<SeedDemoResult> {
  const { roles, locationMap, categories } = system;

  // ─── 6. Users ────────────────────────────────────────────────────────────
  console.log('Creating demo users...');

  const userDefs = [
    {
      name: 'Super Admin',
      email: 'superadmin@wedison.co',
      employeeId: 'EMP001',
      roleName: 'SUPER_ADMIN',
      locationId: undefined as string | undefined,
    },
    {
      name: 'Admin User',
      email: 'admin@wedison.co',
      employeeId: 'EMP002',
      roleName: 'ADMIN',
      locationId: undefined as string | undefined,
    },
    {
      name: 'Manager User',
      email: 'manager@wedison.co',
      employeeId: 'EMP003',
      roleName: 'MANAGER',
      locationId: locationMap['PI-JKT'],
    },
  ];

  // Per-user unique passwords. Compromise of one account ≠ compromise
  // of all three. Source code holds no password literals.
  const credentials: SeedDemoResult['credentials'] = [];
  for (const u of userDefs) {
    const { password, source } = resolvePassword(u.employeeId);
    credentials.push({ employeeId: u.employeeId, email: u.email, password, source });
  }

  // Hash each password individually (different hashes for different
  // passwords). bcrypt cost 12 matches prod auth setting.
  const passwordHashes = new Map<string, string>();
  for (const c of credentials) {
    passwordHashes.set(c.employeeId, await bcrypt.hash(c.password, 12));
  }

  const users: Record<string, string> = {};
  // Per-user transaction: user row + its initial role assignment must
  // land together. A user without any UserRole is locked out of every
  // permission check (`resolveAuthenticatedUser` aggregates permissions
  // via the join) — worse than not existing at all.
  for (const u of userDefs) {
    const userPasswordHash = passwordHashes.get(u.employeeId)!;
    const userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: u.email },
        // Re-hash + propagate password on every seed run. Without this,
        // a re-run after rotating SEED_DEMO_PASSWORD_* env vars would
        // silently keep the old hash and confuse the operator.
        update: { passwordHash: userPasswordHash },
        create: {
          id: crypto.randomUUID(),
          name: u.name,
          email: u.email,
          passwordHash: userPasswordHash,
          employeeId: u.employeeId,
          status: 'ACTIVE',
        },
      });

      // Composite unique includes nullable locationId — Prisma doesn't
      // treat null as part of the unique key, so use findFirst + create.
      const existingUserRole = await tx.userRole.findFirst({
        where: {
          userId: user.id,
          roleId: roles[u.roleName]!,
          locationId: u.locationId ?? null,
        },
      });
      if (!existingUserRole) {
        await tx.userRole.create({
          data: {
            id: crypto.randomUUID(),
            userId: user.id,
            roleId: roles[u.roleName]!,
            locationId: u.locationId ?? null,
          },
        });
      }

      return user.id;
    });
    users[u.employeeId] = userId;
  }
  console.log(`  ✓ ${Object.keys(users).length} demo users`);

  // ─── 7. Products ─────────────────────────────────────────────────────────
  console.log('Creating demo products...');

  const productDefs = [
    { name: 'MacBook Pro 14', brand: 'Apple', model: 'MBP14-M3', categoryCode: 'IT' },
    { name: 'Dell Monitor 27', brand: 'Dell', model: 'U2723QE', categoryCode: 'IT' },
    { name: 'Office Desk', brand: 'IKEA', model: 'BEKANT', categoryCode: 'FRN' },
    { name: 'Ergonomic Chair', brand: 'Herman Miller', model: 'Aeron', categoryCode: 'FRN' },
    { name: 'Toyota Avanza', brand: 'Toyota', model: 'Avanza 2024', categoryCode: 'VHC' },
  ];

  const products: Record<string, string> = {};
  for (const p of productDefs) {
    const eanCode = `MAN-${p.categoryCode}-${p.model.replace(/\s+/g, '-').toUpperCase()}`;
    const product = await prisma.product.upsert({
      where: { eanCode },
      update: {},
      create: {
        id: crypto.randomUUID(),
        name: p.name,
        brand: p.brand,
        model: p.model,
        categoryId: categories[p.categoryCode]!,
        source: 'MANUAL',
        eanCode,
      },
    });
    products[p.name] = product.id;
  }
  console.log(`  ✓ ${Object.keys(products).length} demo products`);

  // ─── 11b. Vendors ────────────────────────────────────────────────────────
  // Seeded before assets because Asset.vendorId references Vendor.
  // Fake NPWP values intentionally use 00.000.000.* prefix to make them
  // obviously non-real even at a glance.
  console.log('Creating demo vendors...');

  const vendorDefs = [
    {
      name: 'iBox Indonesia',
      taxId: '00.000.000.0-001.000',
      email: 'sales@ibox.example',
      phone: '+62 21 5000-0000',
      address: 'Plaza Indonesia, Jakarta Pusat',
      contactPerson: 'Bambang Pratama',
    },
    {
      name: 'Dell Indonesia',
      taxId: '00.000.000.0-002.000',
      email: 'enterprise@dell.example',
      phone: '+62 21 5290-9999',
      address: 'Wisma 46 Kota BNI, Jakarta',
      contactPerson: 'Siti Rahmawati',
    },
    {
      name: 'IKEA Indonesia',
      taxId: '00.000.000.0-003.000',
      email: 'business@ikea.example',
      phone: '+62 21 8082-1234',
      address: 'Alam Sutera, Tangerang',
      contactPerson: 'Andi Wijaya',
    },
    {
      name: 'Herman Miller Official',
      taxId: '00.000.000.0-004.000',
      email: 'orders@hermanmiller.example',
      phone: '+62 21 8378-1010',
      address: 'Sudirman, Jakarta Selatan',
      contactPerson: 'Maria Santoso',
    },
    {
      name: 'Toyota Astra Motor',
      taxId: '00.000.000.0-005.000',
      email: 'fleet@toyota.example',
      phone: '+62 21 6510-0000',
      address: 'Sunter, Jakarta Utara',
      contactPerson: 'Pak Hartono',
    },
  ];

  const vendorIdByName: Record<string, string> = {};
  for (const v of vendorDefs) {
    const result = await prisma.vendor.upsert({
      where: { name: v.name },
      update: {},
      create: v,
    });
    vendorIdByName[v.name] = result.id;
  }
  console.log(`  ✓ ${vendorDefs.length} demo vendors`);

  // ─── 8. Assets ───────────────────────────────────────────────────────────
  console.log('Creating demo assets...');

  const superAdminId = users['EMP001']!;
  const adminId = users['EMP002']!;
  const managerId = users['EMP003']!;

  const assetDefs = [
    {
      assetNumber: 'WDS-IT-2024-00001',
      name: 'MacBook Pro 14 - Unit 1',
      productName: 'MacBook Pro 14',
      serialNumber: 'FVFC2M3001',
      locationCode: 'PI-HO-L1',
      status: 'ACTIVE' as const,
      condition: 'NEW' as const,
      assignedToUserId: superAdminId,
      purchasePrice: 35000000,
      purchaseDate: new Date('2024-01-15'),
      vendorName: 'iBox Indonesia',
      warrantyEnd: new Date('2025-01-15'),
    },
    {
      assetNumber: 'WDS-IT-2024-00002',
      name: 'MacBook Pro 14 - Unit 2',
      productName: 'MacBook Pro 14',
      serialNumber: 'FVFC2M3002',
      locationCode: 'PI-HO-L2',
      status: 'ACTIVE' as const,
      condition: 'GOOD' as const,
      assignedToUserId: adminId,
      purchasePrice: 35000000,
      purchaseDate: new Date('2024-01-15'),
      vendorName: 'iBox Indonesia',
      warrantyEnd: new Date('2025-01-15'),
    },
    {
      assetNumber: 'WDS-IT-2024-00003',
      name: 'Dell Monitor 27 - Unit 1',
      productName: 'Dell Monitor 27',
      serialNumber: 'DL27U2723001',
      locationCode: 'PI-HO-L1',
      status: 'ACTIVE' as const,
      condition: 'NEW' as const,
      assignedToUserId: superAdminId,
      purchasePrice: 8500000,
      purchaseDate: new Date('2024-02-01'),
      vendorName: 'Dell Indonesia',
      warrantyEnd: new Date('2027-02-01'),
    },
    {
      assetNumber: 'WDS-IT-2024-00004',
      name: 'Dell Monitor 27 - Unit 2',
      productName: 'Dell Monitor 27',
      serialNumber: 'DL27U2723002',
      locationCode: 'PI-HO-L2',
      status: 'BORROWED' as const,
      condition: 'GOOD' as const,
      assignedToUserId: managerId,
      purchasePrice: 8500000,
      purchaseDate: new Date('2024-02-01'),
      vendorName: 'Dell Indonesia',
      warrantyEnd: new Date('2027-02-01'),
    },
    {
      assetNumber: 'WDS-FRN-2024-00001',
      name: 'Office Desk - Unit 1',
      productName: 'Office Desk',
      serialNumber: null,
      locationCode: 'PI-HO-L1',
      status: 'ACTIVE' as const,
      condition: 'NEW' as const,
      assignedToUserId: null,
      purchasePrice: 4500000,
      purchaseDate: new Date('2024-01-10'),
      vendorName: 'IKEA Indonesia',
      warrantyEnd: null,
    },
    {
      assetNumber: 'WDS-FRN-2024-00002',
      name: 'Ergonomic Chair - Unit 1',
      productName: 'Ergonomic Chair',
      serialNumber: 'HM-AERON-001',
      locationCode: 'PI-HO-L1',
      status: 'ACTIVE' as const,
      condition: 'NEW' as const,
      assignedToUserId: superAdminId,
      purchasePrice: 25000000,
      purchaseDate: new Date('2024-01-10'),
      vendorName: 'Herman Miller Official',
      warrantyEnd: new Date('2036-01-10'),
    },
    {
      assetNumber: 'WDS-FRN-2024-00003',
      name: 'Ergonomic Chair - Unit 2',
      productName: 'Ergonomic Chair',
      serialNumber: 'HM-AERON-002',
      locationCode: 'PI-HO-L2',
      status: 'IN_MAINTENANCE' as const,
      condition: 'FAIR' as const,
      assignedToUserId: null,
      purchasePrice: 25000000,
      purchaseDate: new Date('2024-01-10'),
      vendorName: 'Herman Miller Official',
      warrantyEnd: new Date('2036-01-10'),
    },
    {
      assetNumber: 'WDS-VHC-2024-00001',
      name: 'Toyota Avanza - Unit 1',
      productName: 'Toyota Avanza',
      serialNumber: 'MHKA6GJ4J0001',
      locationCode: 'PI-JKT',
      status: 'ACTIVE' as const,
      condition: 'NEW' as const,
      assignedToUserId: null,
      purchasePrice: 270000000,
      purchaseDate: new Date('2024-03-01'),
      vendorName: 'Toyota Astra Motor',
      warrantyEnd: new Date('2027-03-01'),
    },
    {
      assetNumber: 'WDS-IT-2024-00005',
      name: 'MacBook Pro 14 - Unit 3',
      productName: 'MacBook Pro 14',
      serialNumber: 'FVFC2M3003',
      locationCode: 'GB-SR',
      status: 'ACTIVE' as const,
      condition: 'NEW' as const,
      assignedToUserId: null,
      purchasePrice: 35000000,
      purchaseDate: new Date('2024-04-01'),
      vendorName: 'iBox Indonesia',
      warrantyEnd: new Date('2025-04-01'),
    },
    {
      assetNumber: 'WDS-IT-2024-00006',
      name: 'Dell Monitor 27 - Unit 3',
      productName: 'Dell Monitor 27',
      serialNumber: 'DL27U2723003',
      locationCode: 'GB-SR',
      status: 'ACTIVE' as const,
      condition: 'NEW' as const,
      assignedToUserId: null,
      purchasePrice: 8500000,
      purchaseDate: new Date('2024-04-01'),
      vendorName: 'Dell Indonesia',
      warrantyEnd: new Date('2027-04-01'),
    },
  ];

  const assets: Record<
    string,
    { id: string; locationCode: string; assignedToUserId: string | null }
  > = {};
  // Per-asset transaction: asset row + its INITIAL movement land
  // together. An asset without its INITIAL movement breaks the audit
  // narrative (asset list shows "created" but movement history is empty)
  // and confuses every downstream report that joins on movement history.
  for (const a of assetDefs) {
    const vendorId = vendorIdByName[a.vendorName] ?? null;
    const initialRef = `SEED-INIT-${a.assetNumber}`;
    const assetId = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.upsert({
        where: { assetNumber: a.assetNumber },
        update: {},
        create: {
          id: crypto.randomUUID(),
          assetNumber: a.assetNumber,
          name: a.name,
          productId: products[a.productName]!,
          serialNumber: a.serialNumber,
          barcodeValue: a.assetNumber,
          barcodeType: 'CODE128',
          status: a.status,
          condition: a.condition,
          locationId: locationMap[a.locationCode]!,
          assignedToUserId: a.assignedToUserId,
          purchaseDate: a.purchaseDate,
          purchasePrice: a.purchasePrice,
          currency: 'IDR',
          // Phase 17 v2 — populate both the FK and the legacy free-text
          // column. Future migration that drops vendorLegacy is what
          // removes the redundancy; until then, keeping both lets a
          // schema rollback recover the vendor relationship.
          vendorId,
          vendorLegacy: a.vendorName,
          warrantyStartDate: a.purchaseDate,
          warrantyEndDate: a.warrantyEnd,
          usefulLifeMonths: a.productName.includes('Avanza')
            ? 60
            : a.productName.includes('Chair') || a.productName.includes('Desk')
              ? 60
              : 36,
          currentBookValue: a.purchasePrice,
          createdByUserId: superAdminId,
        },
      });

      const existingInit = await tx.assetMovement.findUnique({
        where: { referenceNumber: initialRef },
      });
      if (!existingInit) {
        await tx.assetMovement.create({
          data: {
            id: crypto.randomUUID(),
            assetId: asset.id,
            movementType: 'INITIAL',
            referenceNumber: initialRef,
            toLocationId: locationMap[a.locationCode]!,
            toUserId: a.assignedToUserId,
            performedByUserId: superAdminId,
            approvedByUserId: superAdminId,
            status: 'COMPLETED',
            notes: `Initial registration of asset ${a.assetNumber}`,
            createdAt: new Date('2024-01-15'),
          },
        });
      }

      return asset.id;
    });
    assets[a.assetNumber] = {
      id: assetId,
      locationCode: a.locationCode,
      assignedToUserId: a.assignedToUserId,
    };
  }
  console.log(`  ✓ ${Object.keys(assets).length} demo assets + INITIAL movements`);

  // ─── 9. Asset Number Sequences ───────────────────────────────────────────
  // Create-only: never overwrite an existing counter, because that would
  // roll back the sequence below real assets created in dev. The seed's
  // starting values (IT=6, FRN=3, VHC=1) are only used on a fresh DB.
  console.log('Creating asset number sequences (create-only)...');

  const sequences = [
    { categoryCode: 'IT', year: 2024, currentSequence: 6 },
    { categoryCode: 'FRN', year: 2024, currentSequence: 3 },
    { categoryCode: 'VHC', year: 2024, currentSequence: 1 },
  ];

  for (const seq of sequences) {
    const existing = await prisma.assetNumberSequence.findUnique({
      where: { categoryCode_year: { categoryCode: seq.categoryCode, year: seq.year } },
    });
    if (!existing) {
      await prisma.assetNumberSequence.create({
        data: {
          id: crypto.randomUUID(),
          categoryCode: seq.categoryCode,
          year: seq.year,
          currentSequence: seq.currentSequence,
        },
      });
    }
  }
  console.log(`  ✓ ${sequences.length} sequences (created if missing)`);

  // ─── 10. Asset Movements (non-INITIAL) ───────────────────────────────────
  // INITIAL movements are created together with their asset in the per-asset
  // transaction above. The movements below represent additional lifecycle
  // events (assignment, transfer, loan, maintenance) and are independent
  // of any single asset write, so each gets its own atomic check+create.
  console.log('Creating demo asset movements (non-INITIAL)...');

  let movementsCreated = 0;

  const upsertMovement = async (
    referenceNumber: string,
    data: Parameters<typeof prisma.assetMovement.create>[0]['data'],
  ) => {
    const existing = await prisma.assetMovement.findUnique({
      where: { referenceNumber },
    });
    if (existing) return;
    await prisma.assetMovement.create({ data });
    movementsCreated++;
  };

  await upsertMovement('SEED-ASSIGN-WDS-IT-2024-00002', {
    id: crypto.randomUUID(),
    assetId: assets['WDS-IT-2024-00002']!.id,
    movementType: 'ASSIGNMENT',
    referenceNumber: 'SEED-ASSIGN-WDS-IT-2024-00002',
    toUserId: adminId,
    toLocationId: locationMap['PI-HO-L2']!,
    performedByUserId: superAdminId,
    approvedByUserId: superAdminId,
    status: 'COMPLETED',
    notes: 'Assigned MacBook Pro 14 to Admin User',
    createdAt: new Date('2024-02-01'),
  });

  await upsertMovement('SEED-TRANSFER-WDS-IT-2024-00005', {
    id: crypto.randomUUID(),
    assetId: assets['WDS-IT-2024-00005']!.id,
    movementType: 'LOCATION_TRANSFER',
    referenceNumber: 'SEED-TRANSFER-WDS-IT-2024-00005',
    fromLocationId: locationMap['PI-HO-L1']!,
    toLocationId: locationMap['GB-SR']!,
    performedByUserId: adminId,
    approvedByUserId: superAdminId,
    status: 'COMPLETED',
    notes: 'Transfer MacBook to Bandung Showroom',
    createdAt: new Date('2024-04-01'),
  });

  await upsertMovement('SEED-LOAN-WDS-IT-2024-00004', {
    id: crypto.randomUUID(),
    assetId: assets['WDS-IT-2024-00004']!.id,
    movementType: 'LOAN_OUT',
    referenceNumber: 'SEED-LOAN-WDS-IT-2024-00004',
    toUserId: managerId,
    toLocationId: locationMap['PI-HO-L2']!,
    performedByUserId: adminId,
    approvedByUserId: superAdminId,
    status: 'COMPLETED',
    notes: 'Loaned Dell Monitor to Manager for project use',
    expectedReturnDate: new Date('2024-06-01'),
    createdAt: new Date('2024-03-01'),
  });

  await upsertMovement('SEED-MAINT-WDS-FRN-2024-00003', {
    id: crypto.randomUUID(),
    assetId: assets['WDS-FRN-2024-00003']!.id,
    movementType: 'SEND_TO_MAINTENANCE',
    referenceNumber: 'SEED-MAINT-WDS-FRN-2024-00003',
    fromLocationId: locationMap['PI-HO-L2']!,
    toLocationId: locationMap['PI-SC']!,
    performedByUserId: adminId,
    approvedByUserId: superAdminId,
    status: 'COMPLETED',
    notes: 'Chair sent for maintenance - gas cylinder replacement',
    createdAt: new Date('2024-05-01'),
  });

  console.log(`  ✓ ${movementsCreated} movements created (existing skipped)`);

  // ─── 11. Label Templates ─────────────────────────────────────────────────
  console.log('Creating demo label templates...');

  const labelTemplate1Fields = [
    { type: 'barcode', x: 5, y: 2, width: 40, height: 12 },
    { type: 'text', field: 'asset_number', x: 5, y: 16, fontSize: 8, bold: true },
    { type: 'text', field: 'name', x: 5, y: 22, fontSize: 7, bold: false },
  ];

  const labelTemplate2Fields = [
    { type: 'qr_code', x: 5, y: 5, width: 25, height: 25 },
    { type: 'text', field: 'asset_number', x: 35, y: 5, fontSize: 10, bold: true },
    { type: 'text', field: 'name', x: 35, y: 14, fontSize: 9, bold: false },
    { type: 'text', field: 'location', x: 35, y: 22, fontSize: 8, bold: false },
    { type: 'text', field: 'assigned_to', x: 35, y: 30, fontSize: 8, bold: false },
  ];

  const existingTemplate1 = await prisma.labelTemplate.findFirst({
    where: { name: 'Standard 50x30mm' },
  });
  if (!existingTemplate1) {
    await prisma.labelTemplate.create({
      data: {
        id: crypto.randomUUID(),
        name: 'Standard 50x30mm',
        description: 'Standard label for small assets',
        paperWidthMm: 50,
        paperHeightMm: 30,
        isDefault: true,
        fields: labelTemplate1Fields,
        createdByUserId: superAdminId,
      },
    });
  }

  const existingTemplate2 = await prisma.labelTemplate.findFirst({
    where: { name: 'Large 100x50mm' },
  });
  if (!existingTemplate2) {
    await prisma.labelTemplate.create({
      data: {
        id: crypto.randomUUID(),
        name: 'Large 100x50mm',
        description: 'Large label with QR code and detailed information',
        paperWidthMm: 100,
        paperHeightMm: 50,
        isDefault: false,
        fields: labelTemplate2Fields,
        createdByUserId: superAdminId,
      },
    });
  }
  console.log('  ✓ 2 label templates');

  // ─── 12. Onboarding Tours ────────────────────────────────────────────────
  console.log('Creating onboarding tours...');

  const tourDefs = [
    {
      roleName: 'SUPER_ADMIN',
      name: 'Super Admin Onboarding',
      description: 'Complete system tour for super administrators',
      steps: [
        {
          step_index: 0,
          title: 'tours.super_admin.dashboard.title',
          description: 'tours.super_admin.dashboard.description',
          target_element: "[data-tour='dashboard-summary']",
          position: 'bottom',
          required_permission: null,
          route: '/dashboard',
          is_active: true,
        },
        {
          step_index: 1,
          title: 'tours.super_admin.users.title',
          description: 'tours.super_admin.users.description',
          target_element: "[data-tour='user-management']",
          position: 'right',
          required_permission: { resource: 'users', action: 'manage' },
          route: '/admin/users',
          is_active: true,
        },
        {
          step_index: 2,
          title: 'tours.super_admin.roles.title',
          description: 'tours.super_admin.roles.description',
          target_element: "[data-tour='role-management']",
          position: 'right',
          required_permission: { resource: 'roles', action: 'manage' },
          route: '/admin/roles',
          is_active: true,
        },
        {
          step_index: 3,
          title: 'tours.super_admin.assets.title',
          description: 'tours.super_admin.assets.description',
          target_element: "[data-tour='asset-list']",
          position: 'bottom',
          required_permission: { resource: 'assets', action: 'read' },
          route: '/admin/assets',
          is_active: true,
        },
        {
          step_index: 4,
          title: 'tours.super_admin.reports.title',
          description: 'tours.super_admin.reports.description',
          target_element: "[data-tour='reports-list']",
          position: 'right',
          required_permission: { resource: 'reports', action: 'view' },
          route: '/admin/reports',
          is_active: true,
        },
      ],
    },
    {
      roleName: 'ADMIN',
      name: 'Admin Onboarding',
      description: 'Administrative tour for system administrators',
      steps: [
        {
          step_index: 0,
          title: 'tours.admin.dashboard.title',
          description: 'tours.admin.dashboard.description',
          target_element: "[data-tour='dashboard-summary']",
          position: 'bottom',
          required_permission: null,
          route: '/dashboard',
          is_active: true,
        },
        {
          step_index: 1,
          title: 'tours.admin.users.title',
          description: 'tours.admin.users.description',
          target_element: "[data-tour='user-management']",
          position: 'right',
          required_permission: { resource: 'users', action: 'manage' },
          route: '/admin/users',
          is_active: true,
        },
        {
          step_index: 2,
          title: 'tours.admin.assets.title',
          description: 'tours.admin.assets.description',
          target_element: "[data-tour='asset-list']",
          position: 'bottom',
          required_permission: { resource: 'assets', action: 'read' },
          route: '/admin/assets',
          is_active: true,
        },
        {
          step_index: 3,
          title: 'tours.admin.reports.title',
          description: 'tours.admin.reports.description',
          target_element: "[data-tour='reports-list']",
          position: 'right',
          required_permission: { resource: 'reports', action: 'view' },
          route: '/admin/reports',
          is_active: true,
        },
      ],
    },
    {
      roleName: 'MANAGER',
      name: 'Manager Onboarding',
      description: 'Tour for asset and operations managers',
      steps: [
        {
          step_index: 0,
          title: 'tours.manager.dashboard.title',
          description: 'tours.manager.dashboard.description',
          target_element: "[data-tour='dashboard-summary']",
          position: 'bottom',
          required_permission: null,
          route: '/dashboard',
          is_active: true,
        },
        {
          step_index: 1,
          title: 'tours.manager.assets.title',
          description: 'tours.manager.assets.description',
          target_element: "[data-tour='asset-list']",
          position: 'bottom',
          required_permission: { resource: 'assets', action: 'create' },
          route: '/admin/assets',
          is_active: true,
        },
        {
          step_index: 2,
          title: 'tours.manager.movements.title',
          description: 'tours.manager.movements.description',
          target_element: "[data-tour='movement-list']",
          position: 'right',
          required_permission: { resource: 'movements', action: 'approve' },
          route: '/admin/movements',
          is_active: true,
        },
        {
          step_index: 3,
          title: 'tours.manager.maintenance.title',
          description: 'tours.manager.maintenance.description',
          target_element: "[data-tour='maintenance']",
          position: 'right',
          required_permission: { resource: 'maintenance', action: 'manage' },
          route: '/admin/maintenance',
          is_active: true,
        },
        {
          step_index: 4,
          title: 'tours.manager.reports.title',
          description: 'tours.manager.reports.description',
          target_element: "[data-tour='reports-list']",
          position: 'right',
          required_permission: { resource: 'reports', action: 'view' },
          route: '/admin/reports',
          is_active: true,
        },
      ],
    },
    {
      roleName: 'STAFF',
      name: 'Staff Onboarding',
      description: 'Basic tour for staff members',
      steps: [
        {
          step_index: 0,
          title: 'tours.staff.dashboard.title',
          description: 'tours.staff.dashboard.description',
          target_element: "[data-tour='dashboard-summary']",
          position: 'bottom',
          required_permission: null,
          route: '/dashboard',
          is_active: true,
        },
        {
          step_index: 1,
          title: 'tours.staff.assets.title',
          description: 'tours.staff.assets.description',
          target_element: "[data-tour='asset-list']",
          position: 'bottom',
          required_permission: { resource: 'assets', action: 'read' },
          route: '/admin/assets',
          is_active: true,
        },
        {
          step_index: 2,
          title: 'tours.staff.movements.title',
          description: 'tours.staff.movements.description',
          target_element: "[data-tour='movement-list']",
          position: 'right',
          required_permission: { resource: 'movements', action: 'create' },
          route: '/admin/movements',
          is_active: true,
        },
      ],
    },
    {
      roleName: 'VIEWER',
      name: 'Viewer Onboarding',
      description: 'Read-only tour for viewers',
      steps: [
        {
          step_index: 0,
          title: 'tours.viewer.dashboard.title',
          description: 'tours.viewer.dashboard.description',
          target_element: "[data-tour='dashboard-summary']",
          position: 'bottom',
          required_permission: null,
          route: '/dashboard',
          is_active: true,
        },
        {
          step_index: 1,
          title: 'tours.viewer.assets.title',
          description: 'tours.viewer.assets.description',
          target_element: "[data-tour='asset-list']",
          position: 'bottom',
          required_permission: { resource: 'assets', action: 'read' },
          route: '/admin/assets',
          is_active: true,
        },
        {
          step_index: 2,
          title: 'tours.viewer.reports.title',
          description: 'tours.viewer.reports.description',
          target_element: "[data-tour='reports-list']",
          position: 'right',
          required_permission: { resource: 'reports', action: 'view' },
          route: '/admin/reports',
          is_active: true,
        },
      ],
    },
  ];

  for (const tour of tourDefs) {
    const existingTour = await prisma.onboardingTour.findFirst({
      where: { roleId: roles[tour.roleName]!, name: tour.name },
    });
    if (!existingTour) {
      await prisma.onboardingTour.create({
        data: {
          id: crypto.randomUUID(),
          roleId: roles[tour.roleName]!,
          name: tour.name,
          description: tour.description,
          isActive: true,
          steps: tour.steps,
        },
      });
    }
  }
  console.log(`  ✓ ${tourDefs.length} onboarding tours`);

  return { credentials };
}
