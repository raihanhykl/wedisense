import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('./repository.js', () => ({
  buildAuditWhere: vi.fn(),
  countAuditLogs: vi.fn(),
  findAuditLogById: vi.fn(),
  listAuditLogs: vi.fn(),
  listAuditLogsBatch: vi.fn(),
}));

import { prisma } from '../../lib/prisma.js';
import * as repo from './repository.js';
import {
  EXPORT_MAX_ROWS,
  getAuditLog,
  listAuditLogsPaginated,
  streamAuditCsv,
} from './service.js';

const mockListAuditLogs = repo.listAuditLogs as ReturnType<typeof vi.fn>;
const mockCountAuditLogs = repo.countAuditLogs as ReturnType<typeof vi.fn>;
const mockFindById = repo.findAuditLogById as ReturnType<typeof vi.fn>;
const mockListBatch = repo.listAuditLogsBatch as ReturnType<typeof vi.fn>;
const mockBuildWhere = repo.buildAuditWhere as ReturnType<typeof vi.fn>;
const mockAuditCreate = prisma.auditLog.create as ReturnType<typeof vi.fn>;

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so the `mockResolvedValueOnce` queue
  // from a previous test doesn't bleed in. The trade-off is that any
  // default-return setup gets wiped too, so we re-establish buildAuditWhere
  // here.
  vi.resetAllMocks();
  mockBuildWhere.mockReturnValue({});
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    userId: 'user-1',
    user: { id: 'user-1', name: 'Admin', email: 'admin@test.com' },
    action: 'UPDATE' as const,
    resourceType: 'Asset',
    resourceId: 'asset-42',
    oldValues: { name: 'Old' },
    newValues: { name: 'New' },
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    createdAt: new Date('2026-05-20T09:00:00Z'),
    ...overrides,
  };
}

/**
 * Minimal Response stub that captures everything written via `write()` and
 * end(). Sufficient for asserting the CSV body shape without spinning up
 * a real Express server.
 */
function makeResStub() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  return {
    res: {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
      end() {},
    } as unknown as Response,
    body: () => chunks.join(''),
    headers,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('listAuditLogsPaginated()', () => {
  it('returns shaped DTO list + pagination meta', async () => {
    mockListAuditLogs.mockResolvedValue([makeRow()]);
    mockCountAuditLogs.mockResolvedValue(1);

    const result = await listAuditLogsPaginated({});

    expect(result.items).toHaveLength(1);
    const first = result.items[0]!;
    expect(first.id).toBe('log-1');
    expect(first.action).toBe('UPDATE');
    // List omits heavy payloads — detail endpoint returns them.
    expect(first.oldValues).toBeNull();
    expect(first.newValues).toBeNull();
    expect(first.createdAt).toBe('2026-05-20T09:00:00.000Z');
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('respects custom page + limit', async () => {
    mockListAuditLogs.mockResolvedValue([]);
    mockCountAuditLogs.mockResolvedValue(100);

    const result = await listAuditLogsPaginated({ page: 3, limit: 25 });

    expect(result.meta).toEqual({ page: 3, limit: 25, total: 100, totalPages: 4 });
    // Verify skip = (page - 1) * limit propagated to the repo
    const call = mockListAuditLogs.mock.calls[0] as [unknown, number, number];
    expect(call[1]).toBe(50);
    expect(call[2]).toBe(25);
  });

  it('forwards filter fields to buildAuditWhere (strips pagination)', async () => {
    mockListAuditLogs.mockResolvedValue([]);
    mockCountAuditLogs.mockResolvedValue(0);

    await listAuditLogsPaginated({
      page: 1,
      limit: 20,
      action: 'DELETE',
      resourceType: 'Asset',
    });

    const buildCall = mockBuildWhere.mock.calls[0] as [Record<string, unknown>];
    expect(buildCall[0]).toEqual({ action: 'DELETE', resourceType: 'Asset' });
    expect(buildCall[0]).not.toHaveProperty('page');
    expect(buildCall[0]).not.toHaveProperty('limit');
  });

  it('handles row with null user (user deleted, audit row preserved)', async () => {
    mockListAuditLogs.mockResolvedValue([makeRow({ userId: null, user: null })]);
    mockCountAuditLogs.mockResolvedValue(1);

    const result = await listAuditLogsPaginated({});

    expect(result.items[0]!.userId).toBeNull();
    expect(result.items[0]!.user).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getAuditLog()', () => {
  it('returns the row with full payloads when found', async () => {
    mockFindById.mockResolvedValue(makeRow());

    const result = await getAuditLog('log-1');

    expect(result.oldValues).toEqual({ name: 'Old' });
    expect(result.newValues).toEqual({ name: 'New' });
  });

  it('throws 404 AppError when row is missing', async () => {
    mockFindById.mockResolvedValue(null);

    await expect(getAuditLog('nonexistent')).rejects.toMatchObject({
      code: 'AUDIT_LOG_NOT_FOUND',
      statusCode: 404,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('streamAuditCsv()', () => {
  it('writes BOM + header line + one row + ends with audit-of-audit log', async () => {
    mockListBatch.mockResolvedValueOnce([makeRow()]).mockResolvedValueOnce([]);
    mockAuditCreate.mockResolvedValue({});

    const { res, body, headers } = makeResStub();
    await streamAuditCsv({}, 'actor-1', res);

    expect(headers['Content-Type']).toContain('text/csv');
    expect(headers['Content-Disposition']).toMatch(/attachment; filename="audit-/);
    const output = body();
    expect(output.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(output).toContain(
      'timestamp,user_id,user_name,user_email,action,resource_type,resource_id,ip_address,user_agent,old_values,new_values',
    );
    expect(output).toContain('2026-05-20T09:00:00.000Z');
    expect(output).toContain('Admin');
    expect(output).toContain('"{""name"":""Old""}"'); // CSV-escaped JSON

    // The export itself is recorded as an EXPORT audit row.
    expect(mockAuditCreate).toHaveBeenCalledOnce();
    const auditCall = mockAuditCreate.mock.calls[0]?.[0] as {
      data: { action: string; resourceType: string };
    };
    expect(auditCall.data.action).toBe('EXPORT');
    expect(auditCall.data.resourceType).toBe('AuditLog');
  });

  it('CSV-escapes cells with commas, quotes, and newlines', async () => {
    mockListBatch
      .mockResolvedValueOnce([
        makeRow({
          userAgent: 'Mozilla/5.0 "Chrome", build 1\nline2',
          resourceId: 'has,comma',
        }),
      ])
      .mockResolvedValueOnce([]);
    mockAuditCreate.mockResolvedValue({});

    const { res, body } = makeResStub();
    await streamAuditCsv({}, 'actor-1', res);

    const output = body();
    // Comma-bearing field is wrapped + the embedded quote is doubled
    expect(output).toContain('"has,comma"');
    expect(output).toContain('"Mozilla/5.0 ""Chrome"", build 1\nline2"');
  });

  it('appends truncation notice when row cap is hit', async () => {
    // Return EXPORT_MAX_ROWS+1 row count to force truncation; the loop
    // pulls EXPORT_PAGE_SIZE per batch, so generate enough batches.
    const totalNeeded = EXPORT_MAX_ROWS + 100;
    const pageSize = 500;
    const batches: Array<unknown[]> = [];
    let id = 0;
    while (id < totalNeeded) {
      const batch = Array.from({ length: Math.min(pageSize, totalNeeded - id) }, (_, i) =>
        makeRow({ id: `log-${id + i}` }),
      );
      batches.push(batch);
      id += batch.length;
    }
    for (const batch of batches) mockListBatch.mockResolvedValueOnce(batch);
    mockListBatch.mockResolvedValue([]); // Safety net for any extra calls
    mockAuditCreate.mockResolvedValue({});

    const { res, body } = makeResStub();
    await streamAuditCsv({}, 'actor-1', res);

    const output = body();
    expect(output).toContain(`# Truncated at ${EXPORT_MAX_ROWS} rows.`);
    // Audit-of-audit captures the truncated flag
    const auditCall = mockAuditCreate.mock.calls[0]?.[0] as {
      data: { newValues: { truncated: boolean; rowCount: number } };
    };
    expect(auditCall.data.newValues.truncated).toBe(true);
    expect(auditCall.data.newValues.rowCount).toBe(EXPORT_MAX_ROWS);
  });

  it('does NOT throw if the audit-of-audit insert fails', async () => {
    mockListBatch.mockResolvedValueOnce([makeRow()]).mockResolvedValueOnce([]);
    mockAuditCreate.mockRejectedValue(new Error('DB down'));

    const { res } = makeResStub();
    // The CSV body has already streamed by the time the audit insert is
    // attempted. Swallowing the error keeps the user's download intact.
    await expect(streamAuditCsv({}, 'actor-1', res)).resolves.toBeUndefined();
  });

  it('handles empty result set (writes header but no data rows)', async () => {
    mockListBatch.mockResolvedValueOnce([]);
    mockAuditCreate.mockResolvedValue({});

    const { res, body } = makeResStub();
    await streamAuditCsv({}, 'actor-1', res);

    const output = body();
    // BOM + header line + audit (no data rows, no truncation notice)
    const lines = output.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1); // header only
    expect(lines[0]).toMatch(/^\uFEFF?timestamp/u);
  });
});
