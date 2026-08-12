import path from 'path';
import { Prisma, type HandoverFormStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { privateStorage, storage } from '../../lib/storage.js';
import { generateHandoverFormNumber } from '../../utils/document-number.js';
import { renderHandoverFormPdf, type HandoverPdfData, type HandoverPdfParty } from '../../lib/handover-pdf.js';
import { getCompanySetting } from '../settings/service.js';
import * as repo from './repository.js';
import type {
  CreateHandoverFormInput,
  ListHandoverFormQuery,
  UpdateHandoverFormInput,
} from './schema.js';
import type {
  HandoverFormListFilters,
  PartySnapshot,
  PartySnapshotEntry,
  PrismaTransactionClient,
} from './types.js';

const RESOURCE_TYPE = 'HandoverForm';

// ── Read ────────────────────────────────────────────────────────────────────

export function listHandoverForms(filters: HandoverFormListFilters, skip: number, take: number) {
  return repo.findMany(filters, skip, take);
}

export function buildListFilters(query: ListHandoverFormQuery): HandoverFormListFilters {
  return {
    ...(query.search && { search: query.search }),
    ...(query.status?.length && { status: query.status }),
    ...(query.handoverType && { handoverType: query.handoverType }),
    ...(query.dateFrom && { dateFrom: query.dateFrom }),
    ...(query.dateTo && { dateTo: query.dateTo }),
  };
}

export async function getHandoverForm(id: string) {
  const form = await repo.findById(id);
  if (!form) {
    throw new AppError(404, 'HANDOVER_FORM_NOT_FOUND', 'Handover form not found');
  }
  return form;
}

// ── Guards ──────────────────────────────────────────────────────────────────

async function requireForm(id: string, tx?: PrismaTransactionClient) {
  const form = await repo.findBareById(id, tx);
  if (!form) {
    throw new AppError(404, 'HANDOVER_FORM_NOT_FOUND', 'Handover form not found');
  }
  return form;
}

/**
 * Editing is confined to DRAFT. Once the PDF has been generated the number
 * is on paper collecting signatures, so changing the content afterwards
 * would leave the archived scan disagreeing with the database.
 */
function assertEditable(status: HandoverFormStatus): void {
  if (status === 'DRAFT') return;

  if (status === 'CANCELLED') {
    throw new AppError(409, 'HANDOVER_FORM_CANCELLED', 'A cancelled handover form cannot be edited');
  }
  throw new AppError(
    409,
    'HANDOVER_FORM_LOCKED',
    'This form has already been issued for signature and can no longer be edited. Cancel it and create a new one instead.',
  );
}

// ── Snapshot assembly ───────────────────────────────────────────────────────

function toSnapshotEntry(
  user: { id: string; name: string; employeeId: string; email: string } | undefined,
): PartySnapshotEntry | null {
  if (!user) return null;
  return { userId: user.id, name: user.name, employeeId: user.employeeId, email: user.email };
}

/**
 * Resolves every referenced user and location and freezes their display
 * details onto the form. Doubles as validation: a party that can't be found
 * (or was soft-deleted) fails here rather than producing a document with a
 * blank name.
 */
async function buildPartySnapshot(
  tx: PrismaTransactionClient,
  input: CreateHandoverFormInput,
): Promise<PartySnapshot> {
  const userIds = [
    input.itOfficerUserId,
    input.fromUserId,
    input.toUserId,
    input.acknowledgedByUserId,
  ].filter((id): id is string => Boolean(id));

  const users = await repo.findUsersByIds(tx, [...new Set(userIds)]);
  const usersById = new Map(users.map((u) => [u.id, u]));

  for (const id of new Set(userIds)) {
    if (!usersById.has(id)) {
      throw new AppError(404, 'USER_NOT_FOUND', `Referenced user ${id} was not found`);
    }
  }

  const locationIds = [input.fromLocationId, input.toLocationId].filter(
    (id): id is string => Boolean(id),
  );
  const locations = locationIds.length
    ? await repo.findLocationsByIds(tx, [...new Set(locationIds)])
    : [];
  const locationsById = new Map(locations.map((l) => [l.id, l]));

  for (const id of new Set(locationIds)) {
    if (!locationsById.has(id)) {
      throw new AppError(404, 'LOCATION_NOT_FOUND', `Referenced location ${id} was not found`);
    }
  }

  return {
    itOfficer: toSnapshotEntry(usersById.get(input.itOfficerUserId)),
    fromUser: input.fromUserId ? toSnapshotEntry(usersById.get(input.fromUserId)) : null,
    toUser: input.toUserId ? toSnapshotEntry(usersById.get(input.toUserId)) : null,
    acknowledgedBy: input.acknowledgedByUserId
      ? toSnapshotEntry(usersById.get(input.acknowledgedByUserId))
      : null,
    fromLocationName: input.fromLocationId
      ? (locationsById.get(input.fromLocationId)?.name ?? null)
      : null,
    toLocationName: input.toLocationId
      ? (locationsById.get(input.toLocationId)?.name ?? null)
      : null,
  };
}

/**
 * Snapshots the asset rows behind the form's line items. `condition` is the
 * critical one: the receiver's signature attests to the condition printed on
 * the page, so it must be captured at issue time and never re-read later.
 */
async function buildItemRows(
  tx: PrismaTransactionClient,
  handoverFormId: string,
  items: CreateHandoverFormInput['items'],
): Promise<Prisma.HandoverFormItemCreateManyInput[]> {
  const assetIds = items.map((item) => item.assetId);
  const assets = await repo.findAssetsByIds(tx, assetIds);
  const assetsById = new Map(assets.map((a) => [a.id, a]));

  const missing = assetIds.filter((id) => !assetsById.has(id));
  if (missing.length > 0) {
    throw new AppError(
      404,
      'ASSET_NOT_FOUND',
      `Asset(s) not found or deleted: ${missing.join(', ')}`,
    );
  }

  return items.map((item, index) => {
    const asset = assetsById.get(item.assetId)!;
    return {
      handoverFormId,
      assetId: asset.id,
      sortOrder: index,
      assetNumber: asset.assetNumber,
      assetName: asset.name,
      serialNumber: asset.serialNumber,
      condition: asset.condition,
      itemNotes: item.itemNotes ?? null,
    };
  });
}

function buildFormData(
  input: CreateHandoverFormInput,
  snapshot: PartySnapshot,
): Omit<Prisma.HandoverFormUncheckedCreateInput, 'id' | 'formNumber' | 'createdByUserId'> {
  return {
    handoverType: input.handoverType,
    handoverDate: input.handoverDate,
    itOfficerUserId: input.itOfficerUserId,
    fromUserId: input.fromUserId ?? null,
    toUserId: input.toUserId ?? null,
    acknowledgedByUserId: input.acknowledgedByUserId ?? null,
    fromLocationId: input.fromLocationId ?? null,
    toLocationId: input.toLocationId ?? null,
    purpose: input.purpose ?? null,
    notes: input.notes ?? null,
    partySnapshot: snapshot as unknown as Prisma.InputJsonValue,
  };
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createHandoverForm(input: CreateHandoverFormInput, userId: string) {
  const company = await getCompanySetting();

  return prisma.$transaction(async (tx) => {
    const snapshot = await buildPartySnapshot(tx, input);

    // Allocated inside the transaction: if anything below fails, the counter
    // rolls back rather than burning a document number on a form that never
    // existed.
    const formNumber = await generateHandoverFormNumber(tx, {
      divisionCode: company.divisionCode,
      documentCode: company.documentCode,
      date: input.handoverDate,
    });

    const created = await tx.handoverForm.create({
      data: {
        ...buildFormData(input, snapshot),
        formNumber,
        createdByUserId: userId,
      },
    });

    const itemRows = await buildItemRows(tx, created.id, input.items);
    await repo.createItemsInTransaction(tx, itemRows);

    await repo.createAuditLogInTransaction(tx, {
      userId,
      action: 'CREATE',
      resourceType: RESOURCE_TYPE,
      resourceId: created.id,
      newValues: {
        formNumber,
        handoverType: created.handoverType,
        itemCount: itemRows.length,
      } as unknown as Prisma.InputJsonValue,
    });

    return repo.findById(created.id, tx);
  });
}

// ── Update ──────────────────────────────────────────────────────────────────

export async function updateHandoverForm(
  id: string,
  input: UpdateHandoverFormInput,
  userId: string,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await requireForm(id, tx);
    assertEditable(existing.status);

    const snapshot = await buildPartySnapshot(tx, input);

    await tx.handoverForm.update({
      where: { id },
      data: buildFormData(input, snapshot),
    });

    // Items are replaced wholesale rather than diffed: they are a frozen
    // snapshot with no identity of their own, so a rewrite is both simpler
    // and guaranteed to leave no stale rows behind.
    await repo.deleteItemsInTransaction(tx, id);
    const itemRows = await buildItemRows(tx, id, input.items);
    await repo.createItemsInTransaction(tx, itemRows);

    await repo.createAuditLogInTransaction(tx, {
      userId,
      action: 'UPDATE',
      resourceType: RESOURCE_TYPE,
      resourceId: id,
      oldValues: {
        handoverType: existing.handoverType,
        handoverDate: existing.handoverDate,
      } as unknown as Prisma.InputJsonValue,
      newValues: {
        handoverType: input.handoverType,
        handoverDate: input.handoverDate,
        itemCount: itemRows.length,
      } as unknown as Prisma.InputJsonValue,
    });

    return repo.findById(id, tx);
  });
}

// ── Delete / cancel ─────────────────────────────────────────────────────────

export async function deleteHandoverForm(id: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await requireForm(id, tx);
    assertEditable(existing.status);

    // Belt-and-braces: a DRAFT should never have movements against it, but
    // deleting the legal record behind a recorded movement must be
    // impossible regardless of how the form reached this state.
    const movementCount = await repo.countMovements(id, tx);
    if (movementCount > 0) {
      throw new AppError(
        409,
        'HANDOVER_FORM_IN_USE',
        `This form is referenced by ${movementCount} asset movement(s) and cannot be deleted`,
      );
    }

    await tx.handoverForm.update({ where: { id }, data: { deletedAt: new Date() } });

    await repo.createAuditLogInTransaction(tx, {
      userId,
      action: 'DELETE',
      resourceType: RESOURCE_TYPE,
      resourceId: id,
      oldValues: { formNumber: existing.formNumber } as unknown as Prisma.InputJsonValue,
    });
  });
}

export async function cancelHandoverForm(id: string, reason: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await requireForm(id, tx);

    if (existing.status === 'CANCELLED') {
      throw new AppError(409, 'HANDOVER_FORM_CANCELLED', 'This form is already cancelled');
    }

    const movementCount = await repo.countMovements(id, tx);
    if (movementCount > 0) {
      throw new AppError(
        409,
        'HANDOVER_FORM_IN_USE',
        `This form is referenced by ${movementCount} asset movement(s) and cannot be cancelled`,
      );
    }

    // Reason is appended rather than replacing notes so the original
    // context survives alongside the cancellation record.
    const notes = existing.notes ? `${existing.notes}\n\n[CANCELLED] ${reason}` : `[CANCELLED] ${reason}`;

    await tx.handoverForm.update({ where: { id }, data: { status: 'CANCELLED', notes } });

    await repo.createAuditLogInTransaction(tx, {
      userId,
      action: 'UPDATE',
      resourceType: RESOURCE_TYPE,
      resourceId: id,
      oldValues: { status: existing.status } as unknown as Prisma.InputJsonValue,
      newValues: { status: 'CANCELLED', reason } as unknown as Prisma.InputJsonValue,
    });

    return repo.findById(id, tx);
  });
}

// ── PDF ─────────────────────────────────────────────────────────────────────

function snapshotToParty(
  entry: PartySnapshotEntry | null,
  locationName: string | null,
): HandoverPdfParty | null {
  if (!entry) return null;
  return { name: entry.name, employeeId: entry.employeeId, locationName };
}

/**
 * Renders the BAST PDF and, on the first render, promotes DRAFT → ISSUED.
 *
 * The transition lives here rather than in a separate "issue" endpoint
 * because downloading the PDF is precisely the moment the document escapes
 * into the physical world; any later edit would desync paper from database.
 */
export async function generateHandoverFormPdf(
  id: string,
  userId: string,
): Promise<{ buffer: Buffer; formNumber: string }> {
  const form = await getHandoverForm(id);

  if (form.status === 'CANCELLED') {
    throw new AppError(
      409,
      'HANDOVER_FORM_CANCELLED',
      'Cannot generate a PDF for a cancelled handover form',
    );
  }

  const company = await getCompanySetting();
  const snapshot = (form.partySnapshot as unknown as PartySnapshot | null) ?? null;

  // Fall back to the live relations only when the snapshot is missing (rows
  // predating this field). Normal path always reads the frozen copy.
  const itOfficer: HandoverPdfParty = snapshotToParty(
    snapshot?.itOfficer ?? null,
    null,
  ) ?? {
    name: form.itOfficer?.name ?? '-',
    employeeId: form.itOfficer?.employeeId ?? null,
    locationName: null,
  };

  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';

  const data: HandoverPdfData = {
    formNumber: form.formNumber,
    handoverType: form.handoverType,
    handoverDate: form.handoverDate,
    company: {
      name: company.name,
      address: company.address,
      city: company.city,
      province: company.province,
      postalCode: company.postalCode,
      phone: company.phone,
      email: company.email,
      website: company.website,
      logoAbsolutePath: resolveLogoPath(company.logoUrl),
    },
    firstParty: snapshotToParty(
      snapshot?.fromUser ?? null,
      snapshot?.fromLocationName ?? form.fromLocation?.name ?? null,
    ),
    secondParty: snapshotToParty(
      snapshot?.toUser ?? null,
      snapshot?.toLocationName ?? form.toLocation?.name ?? null,
    ),
    itOfficer,
    acknowledgedBy: snapshotToParty(snapshot?.acknowledgedBy ?? null, null),
    purpose: form.purpose,
    notes: form.notes,
    items: form.items.map((item) => ({
      assetNumber: item.assetNumber,
      assetName: item.assetName,
      serialNumber: item.serialNumber,
      condition: item.condition,
      itemNotes: item.itemNotes,
    })),
    qrUrl: `${appUrl}/admin/handover-forms/${form.id}`,
  };

  const buffer = await renderHandoverFormPdf(data);

  // Only after the render succeeds — a failed render must not lock the form.
  if (form.status === 'DRAFT') {
    await prisma.$transaction(async (tx) => {
      await tx.handoverForm.update({
        where: { id },
        data: { status: 'ISSUED', pdfGeneratedAt: new Date() },
      });
      await repo.createAuditLogInTransaction(tx, {
        userId,
        action: 'PRINT',
        resourceType: RESOURCE_TYPE,
        resourceId: id,
        newValues: { status: 'ISSUED', formNumber: form.formNumber } as unknown as Prisma.InputJsonValue,
      });
    });
  }

  return { buffer, formNumber: form.formNumber };
}

/**
 * Maps the stored public logo URL ("/uploads/company/logo-x.png?v=123") back
 * to an absolute path pdfkit can read. Returns null for anything that
 * doesn't look like a local upload so a stray external URL can't be turned
 * into a filesystem read.
 */
function resolveLogoPath(logoUrl: string | null): string | null {
  if (!logoUrl) return null;

  const withoutQuery = logoUrl.split('?')[0] ?? '';
  const prefix = '/uploads/';
  if (!withoutQuery.startsWith(prefix)) return null;

  const relative = withoutQuery.slice(prefix.length);
  // Reject traversal outright rather than relying on the caller's input
  // being trustworthy.
  if (!relative || relative.includes('..')) return null;

  return storage.getAbsolutePath(relative);
}

// ── Signed scan ─────────────────────────────────────────────────────────────

const SCAN_MAX_BYTES = 10 * 1024 * 1024;

function scanRelativePath(formId: string): string {
  return path.join('handover-scans', `${formId}.pdf`);
}

/**
 * Stores the scanned, wet-signed document and moves the form to SIGNED.
 *
 * Only ISSUED (or already-SIGNED, for a re-scan) forms accept a scan: a
 * DRAFT has never been printed, so a "signed" scan of it would be a
 * document nobody could have signed.
 */
export async function attachSignedScan(
  id: string,
  file: { buffer: Buffer; originalname: string },
  userId: string,
) {
  const existing = await requireForm(id);

  if (existing.status === 'DRAFT') {
    throw new AppError(
      409,
      'HANDOVER_FORM_NOT_ISSUED',
      'Generate and print the PDF before uploading a signed scan',
    );
  }
  if (existing.status === 'CANCELLED') {
    throw new AppError(
      409,
      'HANDOVER_FORM_CANCELLED',
      'Cannot attach a scan to a cancelled handover form',
    );
  }

  if (file.buffer.length === 0) {
    throw new AppError(400, 'EMPTY_FILE', 'Uploaded scan is empty');
  }
  if (file.buffer.length > SCAN_MAX_BYTES) {
    throw new AppError(400, 'FILE_TOO_LARGE', 'Scan must be 10MB or smaller');
  }
  // Content check, not extension: a renamed .exe must not land in storage.
  if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new AppError(
      400,
      'INVALID_FILE_TYPE',
      'Scan must be a PDF file (missing %PDF- header)',
    );
  }

  const relativePath = scanRelativePath(id);
  await privateStorage.save(relativePath, file.buffer);

  return prisma.$transaction(async (tx) => {
    await tx.handoverForm.update({
      where: { id },
      data: {
        status: 'SIGNED',
        scanFilePath: relativePath,
        scanFileName: file.originalname,
        scanFileSize: file.buffer.length,
        scanUploadedAt: new Date(),
        scanUploadedByUserId: userId,
      },
    });

    await repo.createAuditLogInTransaction(tx, {
      userId,
      action: 'UPDATE',
      resourceType: RESOURCE_TYPE,
      resourceId: id,
      oldValues: { status: existing.status } as unknown as Prisma.InputJsonValue,
      newValues: {
        status: 'SIGNED',
        scanFileName: file.originalname,
      } as unknown as Prisma.InputJsonValue,
    });

    return repo.findById(id, tx);
  });
}

export async function getSignedScan(
  id: string,
): Promise<{ absolutePath: string; fileName: string }> {
  const form = await requireForm(id);

  if (!form.scanFilePath) {
    throw new AppError(404, 'SCAN_NOT_FOUND', 'No signed scan has been uploaded for this form');
  }

  const absolutePath = privateStorage.getAbsolutePath(form.scanFilePath);
  const exists = await privateStorage.exists(form.scanFilePath);
  if (!exists) {
    throw new AppError(
      404,
      'SCAN_FILE_MISSING',
      'The signed scan is recorded but its file is missing from storage',
    );
  }

  return { absolutePath, fileName: form.scanFileName ?? `${form.formNumber}.pdf` };
}

/** Removes a mis-uploaded scan and returns the form to ISSUED. */
export async function deleteSignedScan(id: string, userId: string) {
  const existing = await requireForm(id);

  if (!existing.scanFilePath) {
    throw new AppError(404, 'SCAN_NOT_FOUND', 'No signed scan has been uploaded for this form');
  }

  await privateStorage.delete(existing.scanFilePath);

  return prisma.$transaction(async (tx) => {
    await tx.handoverForm.update({
      where: { id },
      data: {
        status: 'ISSUED',
        scanFilePath: null,
        scanFileName: null,
        scanFileSize: null,
        scanUploadedAt: null,
        scanUploadedByUserId: null,
      },
    });

    await repo.createAuditLogInTransaction(tx, {
      userId,
      action: 'DELETE',
      resourceType: RESOURCE_TYPE,
      resourceId: id,
      oldValues: { scanFileName: existing.scanFileName } as unknown as Prisma.InputJsonValue,
      newValues: { status: 'ISSUED' } as unknown as Prisma.InputJsonValue,
    });

    return repo.findById(id, tx);
  });
}

// ── Cross-module guard (used by the movements service) ──────────────────────

/**
 * Validates that a movement may cite this form, and that the asset being
 * moved actually appears on it. Called inside the movement's transaction so
 * a bad link can never be committed.
 *
 * Without the membership check, an operator could attach a BAST for
 * employee A's laptop to a movement for employee B's monitor and the
 * paperwork trail would silently be wrong.
 */
export async function assertFormCoversAsset(
  tx: PrismaTransactionClient,
  handoverFormId: string,
  assetId: string,
): Promise<void> {
  const form = await repo.findBareById(handoverFormId, tx);
  if (!form) {
    throw new AppError(404, 'HANDOVER_FORM_NOT_FOUND', 'Handover form not found');
  }
  if (form.status === 'CANCELLED') {
    throw new AppError(
      400,
      'HANDOVER_FORM_CANCELLED',
      'Cannot record a movement against a cancelled handover form',
    );
  }
  if (form.status === 'DRAFT') {
    throw new AppError(
      400,
      'HANDOVER_FORM_NOT_ISSUED',
      'This handover form has not been issued yet — generate its PDF first',
    );
  }

  const item = await tx.handoverFormItem.findUnique({
    where: { handoverFormId_assetId: { handoverFormId, assetId } },
    select: { id: true },
  });

  if (!item) {
    throw new AppError(
      400,
      'ASSET_NOT_IN_HANDOVER_FORM',
      `Asset is not listed on handover form ${form.formNumber}`,
    );
  }
}
