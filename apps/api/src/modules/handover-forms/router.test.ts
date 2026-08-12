/**
 * Integration tests for the handover-form (BAST) HTTP layer.
 *
 * Same approach as audit/router.test.ts: stub-auth middleware injects
 * req.user, the real router runs (exercising authorize() + Zod, including
 * the cross-field party rules), and the service is mocked so no DB or
 * filesystem is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: { handoverForm: { findFirst: vi.fn() }, $transaction: vi.fn() },
}));

vi.mock('./service.js', () => ({
  listHandoverForms: vi.fn(),
  buildListFilters: vi.fn(() => ({})),
  getHandoverForm: vi.fn(),
  createHandoverForm: vi.fn(),
  updateHandoverForm: vi.fn(),
  deleteHandoverForm: vi.fn(),
  cancelHandoverForm: vi.fn(),
  generateHandoverFormPdf: vi.fn(),
  attachSignedScan: vi.fn(),
  getSignedScan: vi.fn(),
  deleteSignedScan: vi.fn(),
}));

import { handoverFormRouter } from './router.js';
import * as service from './service.js';
import { errorHandler, AppError } from '../../middleware/error-handler.js';
import type { AuthenticatedUser } from '../auth/types.js';

type MockFn = ReturnType<typeof vi.fn>;

const mockList = service.listHandoverForms as MockFn;
const mockGet = service.getHandoverForm as MockFn;
const mockCreate = service.createHandoverForm as MockFn;
const mockUpdate = service.updateHandoverForm as MockFn;
const mockDelete = service.deleteHandoverForm as MockFn;
const mockCancel = service.cancelHandoverForm as MockFn;
const mockPdf = service.generateHandoverFormPdf as MockFn;
const mockAttachScan = service.attachSignedScan as MockFn;

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FORM_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const IT_OFFICER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EMPLOYEE_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const EMPLOYEE_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ASSET_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const ALL_PERMS = [
  'handover-forms:read',
  'handover-forms:create',
  'handover-forms:update',
];

function makeUser(perms: string[] = ALL_PERMS): AuthenticatedUser {
  return {
    id: USER_ID,
    name: 'Admin',
    email: 'admin@test.com',
    employeeId: 'EMP-1',
    preferredLanguage: 'id',
    status: 'ACTIVE',
    roles: [{ id: 'role-1', name: 'ADMIN', locationId: null }],
    permissions: perms,
    accessibleLocationIds: [],
    hasIncompleteTour: false,
  };
}

function buildApp(user: AuthenticatedUser): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction): void => {
    req.user = user;
    next();
  });
  app.use('/api/handover-forms', handoverFormRouter);
  app.use(errorHandler);
  return app;
}

/** Valid COMPANY_TO_EMPLOYEE body; override fields per test. */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    handoverType: 'COMPANY_TO_EMPLOYEE',
    handoverDate: '2026-08-12',
    itOfficerUserId: IT_OFFICER,
    toUserId: EMPLOYEE_B,
    items: [{ assetId: ASSET_ID }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (service.buildListFilters as MockFn).mockReturnValue({});
});

// ── Permissions ─────────────────────────────────────────────────────────────

describe('handover-form permissions', () => {
  it('403s a list request without handover-forms:read', async () => {
    const res = await request(buildApp(makeUser(['assets:read']))).get('/api/handover-forms');
    expect(res.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('403s a create without handover-forms:create', async () => {
    const res = await request(buildApp(makeUser(['handover-forms:read'])))
      .post('/api/handover-forms')
      .send(validBody());
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('403s an update without handover-forms:update', async () => {
    const res = await request(buildApp(makeUser(['handover-forms:read', 'handover-forms:create'])))
      .put(`/api/handover-forms/${FORM_ID}`)
      .send(validBody());
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('403s a delete without handover-forms:update', async () => {
    const res = await request(buildApp(makeUser(['handover-forms:read']))).delete(
      `/api/handover-forms/${FORM_ID}`,
    );
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('lets a read-only caller reach the signed scan endpoint', async () => {
    // STAFF and VIEWER hold read only; they still need the evidence behind a
    // movement they are looking at. Rejecting from the service (rather than
    // letting sendFile hit a fake path) keeps the assertion on authorize()
    // without spraying filesystem errors through the test output.
    (service.getSignedScan as MockFn).mockRejectedValue(
      new AppError(404, 'SCAN_NOT_FOUND', 'No signed scan uploaded'),
    );

    const res = await request(buildApp(makeUser(['handover-forms:read']))).get(
      `/api/handover-forms/${FORM_ID}/scan`,
    );

    expect(res.status).toBe(404);
    expect(service.getSignedScan).toHaveBeenCalledWith(FORM_ID);
  });

  it('403s the signed scan for a caller with no handover permission at all', async () => {
    const res = await request(buildApp(makeUser(['assets:read']))).get(
      `/api/handover-forms/${FORM_ID}/scan`,
    );

    expect(res.status).toBe(403);
    expect(service.getSignedScan).not.toHaveBeenCalled();
  });
});

// ── Party validation (the superRefine rules) ────────────────────────────────

describe('POST /api/handover-forms — party rules', () => {
  it('creates a valid company-to-employee form', async () => {
    mockCreate.mockResolvedValue({ id: FORM_ID, formNumber: '001/BAST-IT/WDS/VIII/2026' });

    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.data.formNumber).toBe('001/BAST-IT/WDS/VIII/2026');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]![1]).toBe(USER_ID);
  });

  it('422s a company-to-employee form with no receiver', async () => {
    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(validBody({ toUserId: undefined }));

    expect(res.status).toBe(422);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('422s a company-to-employee form that also names a handing-over employee', async () => {
    // Would otherwise print a PIHAK PERTAMA block naming someone who never
    // held the asset.
    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(validBody({ fromUserId: EMPLOYEE_A }));

    expect(res.status).toBe(422);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('422s an employee-to-employee form missing fromUserId', async () => {
    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(validBody({ handoverType: 'EMPLOYEE_TO_EMPLOYEE', fromUserId: undefined }));

    expect(res.status).toBe(422);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('422s an employee-to-employee form where both parties are the same person', async () => {
    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(
        validBody({
          handoverType: 'EMPLOYEE_TO_EMPLOYEE',
          fromUserId: EMPLOYEE_A,
          toUserId: EMPLOYEE_A,
        }),
      );

    expect(res.status).toBe(422);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('accepts an employee-to-employee form with two distinct parties', async () => {
    mockCreate.mockResolvedValue({ id: FORM_ID });

    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(
        validBody({
          handoverType: 'EMPLOYEE_TO_EMPLOYEE',
          fromUserId: EMPLOYEE_A,
          toUserId: EMPLOYEE_B,
        }),
      );

    expect(res.status).toBe(201);
  });

  it('422s an employee-to-company return that also names a receiver', async () => {
    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(
        validBody({
          handoverType: 'EMPLOYEE_TO_COMPANY',
          fromUserId: EMPLOYEE_A,
          toUserId: EMPLOYEE_B,
        }),
      );

    expect(res.status).toBe(422);
  });

  it('accepts an employee-to-company return', async () => {
    mockCreate.mockResolvedValue({ id: FORM_ID });

    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(
        validBody({
          handoverType: 'EMPLOYEE_TO_COMPANY',
          fromUserId: EMPLOYEE_A,
          toUserId: undefined,
        }),
      );

    expect(res.status).toBe(201);
  });
});

// ── Item validation ─────────────────────────────────────────────────────────

describe('POST /api/handover-forms — items', () => {
  it('422s a form with no assets', async () => {
    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(validBody({ items: [] }));

    expect(res.status).toBe(422);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('422s a form listing the same asset twice', async () => {
    // Duplicate lines would make the signed quantities ambiguous.
    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(validBody({ items: [{ assetId: ASSET_ID }, { assetId: ASSET_ID }] }));

    expect(res.status).toBe(422);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('422s a non-uuid assetId', async () => {
    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(validBody({ items: [{ assetId: 'not-a-uuid' }] }));

    expect(res.status).toBe(422);
  });

  it('accepts a multi-asset form', async () => {
    mockCreate.mockResolvedValue({ id: FORM_ID });

    const res = await request(buildApp(makeUser()))
      .post('/api/handover-forms')
      .send(
        validBody({
          items: [
            { assetId: ASSET_ID },
            { assetId: EMPLOYEE_A, itemNotes: 'Lecet di casing' },
          ],
        }),
      );

    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0]![0].items).toHaveLength(2);
  });
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

describe('handover-form lifecycle', () => {
  it('surfaces the 409 when editing an already-issued form', async () => {
    mockUpdate.mockRejectedValue(
      new AppError(409, 'HANDOVER_FORM_LOCKED', 'Already issued for signature'),
    );

    const res = await request(buildApp(makeUser()))
      .put(`/api/handover-forms/${FORM_ID}`)
      .send(validBody());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HANDOVER_FORM_LOCKED');
  });

  it('404s an unknown form', async () => {
    mockGet.mockRejectedValue(
      new AppError(404, 'HANDOVER_FORM_NOT_FOUND', 'Handover form not found'),
    );

    const res = await request(buildApp(makeUser())).get(`/api/handover-forms/${FORM_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('HANDOVER_FORM_NOT_FOUND');
  });

  it('422s a cancellation with no reason', async () => {
    const res = await request(buildApp(makeUser()))
      .post(`/api/handover-forms/${FORM_ID}/cancel`)
      .send({});

    expect(res.status).toBe(422);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('cancels with a reason', async () => {
    mockCancel.mockResolvedValue({ id: FORM_ID, status: 'CANCELLED' });

    const res = await request(buildApp(makeUser()))
      .post(`/api/handover-forms/${FORM_ID}/cancel`)
      .send({ reason: 'Salah pilih karyawan' });

    expect(res.status).toBe(200);
    expect(mockCancel).toHaveBeenCalledWith(FORM_ID, 'Salah pilih karyawan', USER_ID);
  });

  it('409s deleting a form that movements already reference', async () => {
    mockDelete.mockRejectedValue(
      new AppError(409, 'HANDOVER_FORM_IN_USE', 'Referenced by 3 asset movement(s)'),
    );

    const res = await request(buildApp(makeUser())).delete(`/api/handover-forms/${FORM_ID}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HANDOVER_FORM_IN_USE');
  });
});

// ── PDF ─────────────────────────────────────────────────────────────────────

describe('GET /api/handover-forms/:id/pdf', () => {
  it('streams the PDF with a slash-free filename', async () => {
    mockPdf.mockResolvedValue({
      buffer: Buffer.from('%PDF-1.3 fake'),
      formNumber: '001/BAST-IT/WDS/VIII/2026',
    });

    const res = await request(buildApp(makeUser())).get(`/api/handover-forms/${FORM_ID}/pdf`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    // Slashes in the letter number must not survive into the filename or
    // download managers read them as directories.
    expect(res.headers['content-disposition']).toContain('BAST-001-BAST-IT-WDS-VIII-2026.pdf');
    expect(res.headers['content-disposition']).not.toContain('001/BAST');
  });

  it('409s a PDF request for a cancelled form', async () => {
    mockPdf.mockRejectedValue(
      new AppError(409, 'HANDOVER_FORM_CANCELLED', 'Cannot generate a PDF for a cancelled form'),
    );

    const res = await request(buildApp(makeUser())).get(`/api/handover-forms/${FORM_ID}/pdf`);

    expect(res.status).toBe(409);
  });
});

// ── Scan upload ─────────────────────────────────────────────────────────────

describe('POST /api/handover-forms/:id/scan', () => {
  it('400s when no file is attached', async () => {
    const res = await request(buildApp(makeUser())).post(`/api/handover-forms/${FORM_ID}/scan`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_REQUIRED');
    expect(mockAttachScan).not.toHaveBeenCalled();
  });

  it('rejects a non-PDF upload at the multer filter', async () => {
    const res = await request(buildApp(makeUser()))
      .post(`/api/handover-forms/${FORM_ID}/scan`)
      .attach('file', Buffer.from('MZ not a pdf'), {
        filename: 'evil.exe',
        contentType: 'application/octet-stream',
      });

    expect(res.status).toBe(400);
    expect(mockAttachScan).not.toHaveBeenCalled();
  });

  it('passes a PDF upload through to the service', async () => {
    mockAttachScan.mockResolvedValue({ id: FORM_ID, status: 'SIGNED' });

    const res = await request(buildApp(makeUser()))
      .post(`/api/handover-forms/${FORM_ID}/scan`)
      .attach('file', Buffer.from('%PDF-1.4 signed'), {
        filename: 'bast-signed.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    expect(mockAttachScan).toHaveBeenCalledTimes(1);
    const [id, file, userId] = mockAttachScan.mock.calls[0]!;
    expect(id).toBe(FORM_ID);
    expect(file.originalname).toBe('bast-signed.pdf');
    expect(userId).toBe(USER_ID);
  });

  it('409s uploading a scan for a form that was never issued', async () => {
    mockAttachScan.mockRejectedValue(
      new AppError(409, 'HANDOVER_FORM_NOT_ISSUED', 'Generate and print the PDF first'),
    );

    const res = await request(buildApp(makeUser()))
      .post(`/api/handover-forms/${FORM_ID}/scan`)
      .attach('file', Buffer.from('%PDF-1.4 signed'), {
        filename: 'bast.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HANDOVER_FORM_NOT_ISSUED');
  });
});

// ── List ────────────────────────────────────────────────────────────────────

describe('GET /api/handover-forms', () => {
  it('returns a paginated envelope', async () => {
    mockList.mockResolvedValue({
      data: [{ id: FORM_ID, formNumber: '001/BAST-IT/WDS/VIII/2026' }],
      total: 1,
    });

    const res = await request(buildApp(makeUser())).get('/api/handover-forms');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('parses a comma-separated status filter into a list', async () => {
    // The movement picker asks for both issued and signed forms in one call.
    mockList.mockResolvedValue({ data: [], total: 0 });

    const res = await request(buildApp(makeUser())).get(
      '/api/handover-forms?status=ISSUED,SIGNED',
    );

    expect(res.status).toBe(200);
    expect((service.buildListFilters as MockFn).mock.calls[0]![0].status).toEqual([
      'ISSUED',
      'SIGNED',
    ]);
  });

  it('422s an unknown status value', async () => {
    const res = await request(buildApp(makeUser())).get('/api/handover-forms?status=BOGUS');

    expect(res.status).toBe(422);
    expect(mockList).not.toHaveBeenCalled();
  });
});
