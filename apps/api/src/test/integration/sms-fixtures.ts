/**
 * Shared fixtures for SMS integration tests (real PostgreSQL).
 *
 * `resetSmsDatabase()` empties every table the SMS tests write to, then
 * seeds a tiny network: two showrooms under their own city roots, a factory,
 * one product variant, and three users with location-scoped SMS roles.
 */
import { SMS_PERMISSION_LIST, SMS_PERMISSIONS, type SmsPermission } from '@wedisense/shared';
import express, { type Express } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { smsRouter } from '../../modules/sms/index.js';

export interface SmsTestWorld {
  bekasi: { id: string };
  jakarta: { id: string };
  jakartaCity: { id: string };
  factory: { id: string };
  variant: { id: string };
  /** Showroom admin scoped to Bekasi only. */
  bekasiAdmin: { id: string };
  /** Showroom admin scoped to the Jakarta CITY (parent of the showroom). */
  jakartaAdmin: { id: string };
  /** Admin in Bekasi who can only VIEW in Jakarta (scenario A13). */
  bekasiAdminJakartaViewer: { id: string };
  /** Central ops with a global (unscoped) role. */
  centralOps: { id: string };
}

const SMS_TABLES = [
  'sms_idempotency_keys',
  'sms_unit_events',
  'sms_inspections',
  'sms_show_loans',
  'sms_return_requests',
  'sms_rto_contracts',
  'sms_order_lines',
  'sms_orders',
  'sms_shipment_lines',
  'sms_units',
  'sms_shipments',
  'sms_vehicle_variants',
  'sms_vehicle_models',
] as const;

async function createRole(name: string, permissions: readonly SmsPermission[]): Promise<string> {
  const role = await prisma.role.create({ data: { name, isSystem: false } });
  for (const key of permissions) {
    const [resource, action] = key.split(':') as [string, string];
    const permission = await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      update: {},
      create: { resource, action },
    });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
  return role.id;
}

export async function resetSmsDatabase(): Promise<SmsTestWorld> {
  // The test database is disposable; wipe SMS tables and the few shared
  // tables these fixtures own. CASCADE covers the circular unit pointers.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${SMS_TABLES.map((t) => `"${t}"`).join(', ')}, "audit_logs", "user_roles", "role_permissions", "roles", "permissions", "users", "locations" RESTART IDENTITY CASCADE`,
  );

  const jakartaCity = await prisma.location.create({
    data: { name: 'Jakarta', code: 'JKT', type: 'OTHER' },
  });
  const jakarta = await prisma.location.create({
    data: { name: 'Showroom Jakarta', code: 'JKT-SR', type: 'SHOWROOM', parentId: jakartaCity.id },
  });
  const bekasi = await prisma.location.create({
    data: { name: 'Showroom Bekasi', code: 'BKS-SR', type: 'SHOWROOM' },
  });
  const factory = await prisma.location.create({
    data: { name: 'Cikarang Factory', code: 'CKR', type: 'FACTORY' },
  });

  const model = await prisma.smsVehicleModel.create({ data: { code: 'ATHENA', name: 'Athena' } });
  const variant = await prisma.smsVehicleVariant.create({
    data: { modelId: model.id, name: 'Extended', color: 'Black' },
  });

  const adminRoleId = await createRole('TEST_SMS_ADMIN', SMS_PERMISSION_LIST);
  const viewerRoleId = await createRole('TEST_SMS_VIEWER', [SMS_PERMISSIONS.STOCK_VIEW]);

  const user = (name: string, employeeId: string) =>
    prisma.user.create({
      data: {
        name,
        employeeId,
        email: `${employeeId.toLowerCase()}@example.test`,
        // Never used to log in — `authenticate` only requires that an account exists.
        passwordHash: 'integration-test-account',
      },
    });

  const bekasiAdmin = await user('Bekasi Admin', 'T001');
  const jakartaAdmin = await user('Jakarta Admin', 'T002');
  const bekasiAdminJakartaViewer = await user('Bekasi Admin, Jakarta Viewer', 'T003');
  const centralOps = await user('Central Ops', 'T004');

  await prisma.userRole.createMany({
    data: [
      { userId: bekasiAdmin.id, roleId: adminRoleId, locationId: bekasi.id },
      { userId: jakartaAdmin.id, roleId: adminRoleId, locationId: jakartaCity.id },
      { userId: bekasiAdminJakartaViewer.id, roleId: adminRoleId, locationId: bekasi.id },
      { userId: bekasiAdminJakartaViewer.id, roleId: viewerRoleId, locationId: jakarta.id },
      { userId: centralOps.id, roleId: adminRoleId, locationId: null },
    ],
  });

  return {
    bekasi,
    jakarta,
    jakartaCity,
    factory,
    variant,
    bekasiAdmin,
    jakartaAdmin,
    bekasiAdminJakartaViewer,
    centralOps,
  };
}

let vinCounter = 0;
/** A unique, well-formed 17-character VIN for test data. */
export function nextVin(): string {
  vinCounter += 1;
  return `MHWTEST${String(vinCounter).padStart(10, '0')}`;
}

/** A signed access token for `user`, as the login endpoint would issue it. */
export function accessTokenFor(user: { id: string }): string {
  const secret = process.env['JWT_ACCESS_SECRET'] ?? 'dev-access-secret';
  return jwt.sign({ userId: user.id, email: 'integration@example.test', type: 'access' }, secret, {
    expiresIn: '15m',
  });
}

/**
 * The SMS API mounted exactly as in app.ts (authenticate → smsRouter →
 * errorHandler) but without the rest of the app, so these tests need
 * PostgreSQL only — no Redis, queues or rate limiter.
 */
export function createSmsTestApp(): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/sms', authenticate, smsRouter);
  app.use(errorHandler);
  return app;
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
