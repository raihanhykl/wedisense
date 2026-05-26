/**
 * Seed entry point — orchestrates system + (optionally) demo seeding.
 *
 * Behavior:
 *   - System data (permissions, roles, role-permission matrix, locations,
 *     asset categories) is ALWAYS seeded. Safe + required for any fresh
 *     deployment.
 *   - Demo data (test users, sample assets, movements, vendors, label
 *     templates, onboarding tours) is seeded only when `SEED_DEMO=true`
 *     in the environment. Defaults to true in non-production for ergonomic
 *     local dev, and to false in production.
 *
 * Production guard:
 *   - When `NODE_ENV === 'production'`, demo data is hard-disabled and
 *     a confirmation flag (`ALLOW_PROD_SEED=true`) is required even for
 *     system-only seeding. This prevents an accidental `pnpm prisma:seed`
 *     against a prod DATABASE_URL from creating users with known
 *     passwords or resetting state.
 *
 * Usage:
 *   pnpm --filter api prisma:seed                     # dev: full seed
 *   SEED_DEMO=false pnpm --filter api prisma:seed     # dev: system only
 *
 *   # First production deploy (creates SUPER_ADMIN from env vars):
 *   NODE_ENV=production ALLOW_PROD_SEED=true \
 *     BOOTSTRAP_ADMIN_EMAIL=admin@yourcompany.co \
 *     BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -base64 24) \
 *     pnpm --filter api prisma:seed
 *
 *   # Subsequent production re-seeds (after admin exists):
 *   NODE_ENV=production ALLOW_PROD_SEED=true \
 *     pnpm --filter api prisma:seed                   # bootstrap auto-skipped
 */

import { PrismaClient } from '@prisma/client';
import { seedSystem } from './seed-system.js';
import { seedDemo } from './seed-demo.js';
import { backfillAssetVendorIds } from './seed-backfill.js';

const prisma = new PrismaClient();

function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

function shouldSeedDemo(): boolean {
  if (isProduction()) return false;
  // Default true in non-prod for dev ergonomics; opt out with SEED_DEMO=false.
  const flag = process.env['SEED_DEMO'];
  if (flag === undefined) return true;
  return flag.toLowerCase() === 'true' || flag === '1';
}

function isNonProdShared(): boolean {
  // Catches staging, testing, qa, uat — anything that isn't a developer's
  // local machine. Single-developer environments use NODE_ENV=development
  // (or unset, which defaults to dev). Shared non-prod environments must
  // pass ALLOW_NONPROD_SEED=true to confirm intent.
  const env = (process.env['NODE_ENV'] ?? '').toLowerCase();
  if (env === 'staging' || env === 'qa' || env === 'uat' || env === 'test') {
    return true;
  }
  const dbUrl = process.env['DATABASE_URL'] ?? '';
  return /(^|[@/])(staging|stg|qa|uat)[.-]/i.test(dbUrl);
}

function assertSafeToRun(): void {
  if (isProduction() && process.env['ALLOW_PROD_SEED'] !== 'true') {
    console.error(
      '\n❌ Refusing to seed in production without ALLOW_PROD_SEED=true.\n' +
        '   Set ALLOW_PROD_SEED=true explicitly to confirm you intend to seed\n' +
        '   system data (permissions, roles, locations) into the production DB.\n' +
        '   Demo data is never seeded in production regardless of flags.\n',
    );
    process.exit(1);
  }

  // Belt + suspenders: refuse if DATABASE_URL host clearly looks like prod
  // but NODE_ENV wasn't set. Anyone hitting this should fix their env.
  const dbUrl = process.env['DATABASE_URL'] ?? '';
  const looksProd = /(^|[@/])(prod|production)[.-]/i.test(dbUrl);
  if (looksProd && !isProduction()) {
    console.error(
      '\n❌ DATABASE_URL appears to point at a production host but NODE_ENV is\n' +
        '   not "production". Refusing to seed. Either fix NODE_ENV (and pass\n' +
        '   ALLOW_PROD_SEED=true) or point DATABASE_URL at the intended DB.\n',
    );
    process.exit(1);
  }

  // Shared non-prod (staging/qa/uat): refuse unless explicitly confirmed.
  // Same reasoning as the prod guard — fake-credential demo users on a
  // staging environment are a real attack surface, especially when
  // staging is internet-facing for stakeholder review.
  if (isNonProdShared() && process.env['ALLOW_NONPROD_SEED'] !== 'true') {
    console.error(
      '\n❌ Refusing to seed: NODE_ENV or DATABASE_URL indicates a shared\n' +
        '   non-prod environment (staging/qa/uat). Pass ALLOW_NONPROD_SEED=true\n' +
        '   to confirm. Demo data and demo credentials should normally NOT exist\n' +
        '   on shared environments.\n',
    );
    process.exit(1);
  }
}

async function main() {
  assertSafeToRun();

  const seedDemoData = shouldSeedDemo();

  console.log('🌱 Starting seed...');
  console.log(`   environment: ${isProduction() ? 'production' : 'development'}`);
  console.log(`   demo data:   ${seedDemoData ? 'YES' : 'NO'}\n`);

  const system = await seedSystem(prisma);

  let demoCredentials: Awaited<ReturnType<typeof seedDemo>>['credentials'] = [];
  if (seedDemoData) {
    console.log('');
    const result = await seedDemo(prisma, system);
    demoCredentials = result.credentials;
  } else {
    console.log('\n  Skipping demo data (set SEED_DEMO=true to enable).');
  }

  // Phase 17 v2 vendor FK backfill. Runs in every seed mode so legacy
  // data from pre-Phase-17 deployments gets repaired automatically.
  // No-ops on fresh DBs where seed-demo already populated vendorId.
  console.log('\nRunning vendor FK backfill...');
  const backfill = await backfillAssetVendorIds(prisma);
  if (backfill.assetsChecked === 0) {
    console.log('  ✓ No legacy assets to backfill (vendorId already set or no legacy data).');
  } else {
    console.log(
      `  ✓ Checked ${backfill.assetsChecked} asset(s), ` +
        `created ${backfill.vendorsCreated} vendor(s), ` +
        `linked ${backfill.assetsLinked} asset(s).`,
    );
  }

  console.log('\n✅ Seed completed successfully.');

  // Bootstrap admin status — most important when running in production
  // for the first time. Surface it before demo credentials so the
  // operator sees it immediately.
  if (system.adminBootstrap === 'created') {
    console.log(
      '\n🔐 First-admin bootstrap: a SUPER_ADMIN user was created from\n' +
        '   BOOTSTRAP_ADMIN_* env vars. Login + rotate the password now.',
    );
  } else if (system.adminBootstrap === 'skipped-no-env' && !seedDemoData) {
    // Only warn in non-demo mode — in dev with demo enabled, the demo
    // users already provide login access, so the missing bootstrap env
    // isn't actionable until prod deploy.
    console.log(
      '\n⚠️  No login user exists in the DB. Set BOOTSTRAP_ADMIN_EMAIL +\n' +
        '   BOOTSTRAP_ADMIN_PASSWORD and re-run seed to create the first admin.',
    );
  }

  if (demoCredentials.length > 0) {
    const anyRandom = demoCredentials.some((c) => c.source === 'random');
    if (anyRandom) {
      // One-time display: passwords were freshly generated for this run.
      // Operator MUST capture them now — they're not persisted anywhere
      // recoverable (only the bcrypt hashes are stored).
      console.log('\n🔑 Demo credentials (RANDOM — capture now, not stored):');
      for (const c of demoCredentials) {
        const tag =
          c.source === 'random'
            ? '(random)'
            : c.source === 'env-user'
              ? '(from $SEED_DEMO_PASSWORD_' + c.employeeId + ')'
              : '(from $SEED_DEMO_PASSWORD)';
        console.log(`  ${c.email.padEnd(28)} ${c.password}  ${tag}`);
      }
      console.log(
        '\n  Set SEED_DEMO_PASSWORD or SEED_DEMO_PASSWORD_<EMP_ID> to use a\n' +
          '  stable password instead of random ones across re-seeds.',
      );
    } else {
      // All passwords came from env — operator already knows them.
      // Skip printing to avoid leaking env-provided secrets into logs.
      console.log(
        '\n  Demo users seeded with passwords from env vars (not printed).',
      );
    }
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
