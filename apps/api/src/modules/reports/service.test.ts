import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────
// Must be declared before importing the module under test.

// Mock fs at module level — vi.spyOn on ESM named exports is not configurable.
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
    asset: {
      count: vi.fn(),
    },
    assetMovement: {
      count: vi.fn(),
    },
    maintenanceLog: {
      count: vi.fn(),
    },
    report: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
  },
}));

vi.mock('../../lib/storage.js', () => ({
  storage: {
    save: vi.fn().mockResolvedValue('/uploads/reports/report-1.xlsx'),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    getAbsolutePath: vi.fn().mockReturnValue('/absolute/path/report-1.xlsx'),
  },
}));

vi.mock('../../lib/queue.js', () => ({
  reportGenerateQueue: {
    add: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('./repository.js', () => ({
  findMany: vi.fn(),
  count: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('./generators/index.js', () => ({
  generateReport: vi.fn().mockResolvedValue(Buffer.from('report-bytes')),
}));

// Dynamic imports used inside runImportJob are vi.mock'd here.
// Because they are imported via `await import(...)` at runtime, we mock the
// module paths that the function will resolve.
vi.mock('../assets/import-service.js', () => ({
  bulkImport: vi.fn(),
}));

vi.mock('../notifications/service.js', () => ({
  notify: vi.fn().mockResolvedValue({ count: 1 }),
}));

vi.mock('../../lib/excel.js', () => ({
  parseAssetImportSheet: vi.fn(),
}));

import fs from 'fs';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import * as repo from './repository.js';
import { runImportJob, readImportStatus } from './service.js';

// ── Typed mock helpers ────────────────────────────────────────────────────────

const mockRedisGet = redis.get as ReturnType<typeof vi.fn>;
const mockRedisSet = redis.set as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as ReturnType<typeof vi.fn>;
const mockRepoUpdateStatus = repo.updateStatus as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const IMPORT_ID = 'import-abc';
const USER_ID = 'user-1';
const FILE_PATH = '/tmp/uploads/import-abc.xlsx';

const GOOD_PAYLOAD = { importId: IMPORT_ID, userId: USER_ID, filePath: FILE_PATH };

// ─────────────────────────────────────────────────────────────────────────────
describe('readImportStatus()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when key is missing from Redis', async () => {
    mockRedisGet.mockResolvedValue(null);

    const result = await readImportStatus('no-such-import');
    expect(result).toBeNull();
  });

  it('returns parsed object when key is present', async () => {
    const payload = { status: 'completed', created: 5, skipped: 1, failed: 0 };
    mockRedisGet.mockResolvedValue(JSON.stringify(payload));

    const result = await readImportStatus(IMPORT_ID);
    expect(result).toEqual(payload);
  });

  it('returns null when Redis value is malformed JSON', async () => {
    mockRedisGet.mockResolvedValue('{bad json}}');

    const result = await readImportStatus(IMPORT_ID);
    expect(result).toBeNull();
  });

  it('uses the correct Redis key pattern import:{id}:status', async () => {
    mockRedisGet.mockResolvedValue(null);

    await readImportStatus('my-import-id');

    expect(mockRedisGet).toHaveBeenCalledWith('import:my-import-id:status');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runImportJob()', () => {
  // We need to control dynamic imports via their module paths.
  // Import them after vi.mock declarations so we get the mocked versions.
  let mockBulkImport: ReturnType<typeof vi.fn>;
  let mockNotify: ReturnType<typeof vi.fn>;
  let mockParseSheet: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Resolve the mocked dynamic-import modules
    const importServiceMod = await import('../assets/import-service.js');
    const notifMod = await import('../notifications/service.js');
    const excelMod = await import('../../lib/excel.js');

    mockBulkImport = importServiceMod.bulkImport as ReturnType<typeof vi.fn>;
    mockNotify = notifMod.notify as ReturnType<typeof vi.fn>;
    mockParseSheet = excelMod.parseAssetImportSheet as ReturnType<typeof vi.fn>;

    // Default happy-path stubs
    mockRepoUpdateStatus.mockResolvedValue({});
    mockAuditLogCreate.mockResolvedValue({});
    mockNotify.mockResolvedValue({ count: 1 });

    // Default fs stubs — no real file I/O
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from('fake-xlsx'));
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false); // file already gone → unlink not called
    (fs.unlinkSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
  });

  it('writes processing status to Redis at job start', async () => {
    mockParseSheet.mockResolvedValue({ rows: [], errors: [] });
    mockAuditLogCreate.mockResolvedValue({});

    await runImportJob(GOOD_PAYLOAD);

    // First set call should be the initial 'processing' write
    const firstSetCall = mockRedisSet.mock.calls[0] as [string, string, string, number];
    expect(firstSetCall[0]).toBe(`import:${IMPORT_ID}:status`);
    const parsedFirst = JSON.parse(firstSetCall[1]) as { status: string };
    expect(parsedFirst.status).toBe('processing');
  });

  it('writes completed status to Redis after a successful import', async () => {
    mockParseSheet.mockResolvedValue({ rows: [], errors: [] });
    mockAuditLogCreate.mockResolvedValue({});

    await runImportJob(GOOD_PAYLOAD);

    // Last set call should be 'completed'
    const lastSetCall = mockRedisSet.mock.calls[
      mockRedisSet.mock.calls.length - 1
    ] as [string, string, string, number];
    const parsedLast = JSON.parse(lastSetCall[1]) as { status: string };
    expect(parsedLast.status).toBe('completed');
  });

  it('writes failed status to Redis when an error occurs', async () => {
    mockParseSheet.mockRejectedValue(new Error('corrupt file'));
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true); // so finally can unlink

    await expect(runImportJob(GOOD_PAYLOAD)).rejects.toThrow('corrupt file');

    // Should have a Redis set call with status=failed
    const failedCall = mockRedisSet.mock.calls.find((call) => {
      try {
        const p = JSON.parse((call as [string, string])[1]) as { status: string };
        return p.status === 'failed';
      } catch {
        return false;
      }
    });
    expect(failedCall).toBeDefined();
    const failedBody = JSON.parse((failedCall as [string, string])[1]) as {
      status: string;
      error: string;
    };
    expect(failedBody.error).toContain('corrupt file');
  });

  it('cleans up the uploaded file in finally (happy path)', async () => {
    mockParseSheet.mockResolvedValue({ rows: [], errors: [] });
    mockAuditLogCreate.mockResolvedValue({});
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await runImportJob(GOOD_PAYLOAD);

    expect(fs.unlinkSync as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(FILE_PATH);
  });

  it('cleans up the uploaded file in finally (error path)', async () => {
    mockParseSheet.mockRejectedValue(new Error('boom'));
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await expect(runImportJob(GOOD_PAYLOAD)).rejects.toThrow();

    expect(fs.unlinkSync as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(FILE_PATH);
  });

  it('writes audit log on successful completion', async () => {
    mockParseSheet.mockResolvedValue({ rows: [], errors: [] });
    mockAuditLogCreate.mockResolvedValue({});

    await runImportJob(GOOD_PAYLOAD);

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          action: 'IMPORT',
          resourceType: 'Asset',
        }),
      }),
    );
    const auditData = mockAuditLogCreate.mock.calls[0]![0] as {
      data: { newValues: { mode: string; importId: string } };
    };
    expect(auditData.data.newValues).toMatchObject({
      mode: 'async',
      importId: IMPORT_ID,
    });
  });

  it('sends IMPORT_COMPLETE notification after successful run', async () => {
    mockParseSheet.mockResolvedValue({ rows: [], errors: [] });
    mockAuditLogCreate.mockResolvedValue({});

    await runImportJob(GOOD_PAYLOAD);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        type: 'IMPORT_COMPLETE',
      }),
    );
  });

  it('passes bulkImport results (created/skipped/failed counts) into completed status', async () => {
    const rows = [
      { rowIndex: 2, productId: 'p1', name: 'A', status: 'ACTIVE', condition: 'NEW', locationId: 'l1', currency: 'IDR' },
    ];
    mockParseSheet.mockResolvedValue({ rows, errors: [] });
    mockBulkImport.mockResolvedValue({
      created: [{ id: 'asset-1', assetNumber: 'WDS-IT-2026-00001', name: 'A' }],
      skipped: [],
      failed: [],
    });
    mockAuditLogCreate.mockResolvedValue({});

    await runImportJob(GOOD_PAYLOAD);

    const completedCall = mockRedisSet.mock.calls.find((call) => {
      try {
        const p = JSON.parse((call as [string, string])[1]) as { status: string };
        return p.status === 'completed';
      } catch {
        return false;
      }
    });
    const completedBody = JSON.parse((completedCall as [string, string])[1]) as {
      created: number;
      skipped: number;
      failed: number;
    };
    expect(completedBody.created).toBe(1);
    expect(completedBody.skipped).toBe(0);
    expect(completedBody.failed).toBe(0);
  });

  it('does not call notify when an error occurs (notify is after try block)', async () => {
    mockParseSheet.mockRejectedValue(new Error('failed parse'));

    await expect(runImportJob(GOOD_PAYLOAD)).rejects.toThrow();

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('Redis key uses import:{importId}:status pattern with TTL', async () => {
    mockParseSheet.mockResolvedValue({ rows: [], errors: [] });
    mockAuditLogCreate.mockResolvedValue({});

    await runImportJob(GOOD_PAYLOAD);

    // All set calls should target the correct key with EX TTL
    for (const call of mockRedisSet.mock.calls) {
      const [key, , exFlag, ttl] = call as [string, string, string, number];
      expect(key).toBe(`import:${IMPORT_ID}:status`);
      expect(exFlag).toBe('EX');
      expect(ttl).toBe(3600); // 1 hour
    }
  });
});
