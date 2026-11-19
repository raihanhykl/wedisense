/**
 * Business logic for the shipments slice.
 *
 * All multi-table writes run inside runIdempotent → smsTransaction.
 * createUnitWithEvent / recordUnitEvent are the only paths to mutating
 * unit state.
 */
import { Prisma } from '@prisma/client';
import { SMS_PERMISSIONS, SMS_STOCK_LOCATION_TYPES } from '@wedisense/shared';
import { AppError } from '../../../middleware/error-handler.js';
import {
  getSmsAccess,
  assertCan,
  can,
  locationScope,
} from '../lib/access.js';
import { createUnitWithEvent, recordUnitEvent, resolveEventDate } from '../lib/ledger.js';
import { requireIdempotencyKey, runIdempotent } from '../lib/idempotency.js';
import { createAuditLog } from '../lib/audit.js';
import {
  listWorkbookSheets,
  readSheetRows,
  parseDelimitedText,
  detectHeaderRow,
  suggestColumnMapping,
} from '../lib/tabular.js';
import { MANIFEST_FIELD_SYNONYMS, parseManifest } from './manifest-parser.js';
import * as repo from './repository.js';
import { buildPaginationMeta } from '../../../utils/pagination.js';
import type { Request } from 'express';
import type {
  InspectResponse,
  PreviewResponse,
  ConfirmResponse,
  ReceiveResponse,
  FindingsResponse,
  ShipmentListItem,
  ShipmentDetail,
  ClassifiedCandidate,
  UnmatchedVariant,
  SkippedVin,
} from './types.js';
import type { PreviewOptions, ConfirmBody, ReceiveBody, FindingsBody } from './schema.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

function requiredAccess(req: Request) {
  return getSmsAccess(req);
}

/** Parse a source: file buffer (xlsx/xls/csv) or pasted text. */
async function parseSourceToRows(source: FileSource | TextSource): Promise<{
  rows: string[][];
  sheets: Array<{ name: string; rowCount: number }>;
  selectedSheet: string;
}> {
  if (source.kind === 'text') {
    const rows = parseDelimitedText(source.text);
    return {
      rows,
      sheets: [{ name: 'Pasted Data', rowCount: rows.length }],
      selectedSheet: 'Pasted Data',
    };
  }

  const { mime, buffer, sheetName } = source;

  if (mime === 'text/csv') {
    const rows = parseDelimitedText(buffer.toString('utf8'));
    return {
      rows,
      sheets: [{ name: 'CSV', rowCount: rows.length }],
      selectedSheet: 'CSV',
    };
  }

  const sheets = await listWorkbookSheets(buffer);
  const resolved = sheetName ?? sheets[0]?.name ?? '';
  const rows = await readSheetRows(buffer, sheetName);

  return { rows, sheets, selectedSheet: resolved };
}

type FileSource = {
  kind: 'file';
  buffer: Buffer;
  mime: string;
  fileName: string;
  sheetName?: string;
};
type TextSource = {
  kind: 'text';
  text: string;
};

// ── Inspect ───────────────────────────────────────────────────────────────────

export async function inspectSource(
  source: FileSource | TextSource,
): Promise<InspectResponse> {
  const { rows, sheets, selectedSheet } = await parseSourceToRows(source);
  const headerRowIndex = detectHeaderRow(rows, MANIFEST_FIELD_SYNONYMS);
  const headerRow = rows[headerRowIndex] ?? [];
  const dataRows = rows.slice(headerRowIndex + 1, headerRowIndex + 11);
  const suggestedMapping = suggestColumnMapping(headerRow, MANIFEST_FIELD_SYNONYMS);

  return {
    source:
      source.kind === 'file'
        ? { kind: 'file', fileName: source.fileName }
        : { kind: 'text' },
    sheets,
    sheet: {
      name: selectedSheet,
      headerRowIndex,
      headers: headerRow,
      sampleRows: dataRows,
      suggestedMapping,
    },
  };
}

// ── Preview ───────────────────────────────────────────────────────────────────

export async function previewManifest(
  source: FileSource | TextSource,
  options: PreviewOptions,
  req: Request,
): Promise<PreviewResponse> {
  const access = requiredAccess(req);
  const { destinationLocationId, batchNumber } = options;
  const deliveryNoteNumber = options.deliveryNoteNumber ?? '';

  // Validate destination
  await validateStockLocation(destinationLocationId);

  // Authoritative per-location check: coarse gate was already applied in the router
  assertCan(access, SMS_PERMISSIONS.RECEIVING_MANAGE, destinationLocationId);

  // Parse rows from source
  const { rows } = await parseSourceToRows(source);
  const result = parseManifest(rows, options.headerRowIndex, options.mapping);

  const allVins = result.candidates.map((c) => c.vin);

  // Find existing shipment for this batch key
  const existingShipment = await repo.findShipmentByKey(
    destinationLocationId,
    batchNumber,
    deliveryNoteNumber,
  );

  // Classify each candidate
  const [inThisShipment, inOther, existingUnits, variants] = await Promise.all([
    existingShipment
      ? repo.findExistingLinesInShipment(existingShipment.id, allVins)
      : Promise.resolve([]),
    repo.findLinesInOtherShipments(existingShipment?.id ?? null, allVins),
    repo.findExistingUnits(allVins),
    repo.findAllVariantsForMatching(),
  ]);

  const inThisShipmentSet = new Set(inThisShipment.map((l) => l.vin));
  const inOtherMap = new Map(
    inOther.map((l) => [
      l.vin,
      {
        batchNumber: l.shipment.batchNumber,
        destinationName: l.shipment.destinationLocation.name,
      },
    ]),
  );
  const existingUnitMap = new Map(existingUnits.map((u) => [u.vin, u.status]));

  // Build variant lookup for matching
  type VariantRow = { id: string; name: string; color: string; model: { code: string; name: string } };
  const unmatchedMap = new Map<string, { raw: { model: string | null; variant: string | null; color: string | null }; count: number }>();

  function matchVariant(
    rawModel: string | null,
    rawVariant: string | null,
    rawColor: string | null,
  ): string | null {
    if (!rawModel && !rawVariant && !rawColor) return null;
    const rm = rawModel?.toLowerCase() ?? '';
    const rv = rawVariant?.toLowerCase() ?? '';
    const rc = rawColor?.toLowerCase() ?? '';

    const matched = (variants as VariantRow[]).find((v) => {
      const modelMatch = !rm || v.model.code.toLowerCase() === rm || v.model.name.toLowerCase() === rm;
      const variantMatch = !rv || v.name.toLowerCase() === rv;
      const colorMatch = !rc || v.color.toLowerCase() === rc;
      return modelMatch && variantMatch && colorMatch;
    });

    return matched?.id ?? null;
  }

  const candidates: ClassifiedCandidate[] = result.candidates.map((c) => {
    let classification: ClassifiedCandidate['classification'] = 'NEW';
    let otherShipment: ClassifiedCandidate['otherShipment'];
    let existingUnit: ClassifiedCandidate['existingUnit'];

    if (inThisShipmentSet.has(c.vin)) {
      classification = 'ALREADY_IN_THIS_SHIPMENT';
    } else if (inOtherMap.has(c.vin)) {
      classification = 'IN_OTHER_SHIPMENT';
      otherShipment = inOtherMap.get(c.vin);
    } else if (existingUnitMap.has(c.vin)) {
      classification = 'ALREADY_RECEIVED';
      existingUnit = { status: existingUnitMap.get(c.vin)! };
    }

    const variantId = matchVariant(c.model, c.variant, c.color);

    if (!variantId && (c.model || c.variant || c.color)) {
      const key = `${c.model}|${c.variant}|${c.color}`;
      const entry = unmatchedMap.get(key);
      if (entry) {
        entry.count++;
      } else {
        unmatchedMap.set(key, {
          raw: { model: c.model, variant: c.variant, color: c.color },
          count: 1,
        });
      }
    }

    return {
      vin: c.vin,
      engineNumber: c.engineNumber,
      model: c.model,
      variant: c.variant,
      color: c.color,
      variantId,
      classification,
      ...(otherShipment && { otherShipment }),
      ...(existingUnit && { existingUnit }),
      ...(c.conflicts && { conflicts: c.conflicts }),
      sourceRows: c.sourceRows,
    };
  });

  const unmatchedVariants: UnmatchedVariant[] = [...unmatchedMap.values()].map(
    (entry) => ({
      rawModel: entry.raw.model,
      rawVariant: entry.raw.variant,
      rawColor: entry.raw.color,
      count: entry.count,
    }),
  );

  let existingShipmentInfo = null;
  if (existingShipment) {
    const countMap = await repo.getShipmentCounts([existingShipment.id]);
    const counts = countMap.get(existingShipment.id) ?? {
      expected: 0, receivedOk: 0, receivedDamaged: 0, discrepancy: 0, pending: 0,
    };
    existingShipmentInfo = {
      id: existingShipment.id,
      batchNumber: existingShipment.batchNumber,
      deliveryNoteNumber: existingShipment.deliveryNoteNumber,
      counts,
    };
  }

  const summary = {
    total: candidates.length,
    newCount: candidates.filter((c) => c.classification === 'NEW').length,
    alreadyInShipment: candidates.filter((c) => c.classification === 'ALREADY_IN_THIS_SHIPMENT').length,
    inOtherShipment: candidates.filter((c) => c.classification === 'IN_OTHER_SHIPMENT').length,
    alreadyReceived: candidates.filter((c) => c.classification === 'ALREADY_RECEIVED').length,
    skippedComponents: result.skippedComponents.count,
    ambiguous: result.ambiguousRows.length,
  };

  return {
    candidates,
    unmatchedVariants,
    ambiguousRows: result.ambiguousRows,
    skippedComponents: result.skippedComponents,
    existingShipment: existingShipmentInfo,
    summary,
  };
}

// ── Confirm ───────────────────────────────────────────────────────────────────

export async function confirmImport(
  body: ConfirmBody,
  req: Request,
): Promise<ConfirmResponse> {
  const access = requiredAccess(req);
  const idempotencyKey = requireIdempotencyKey(req);
  const actor = { userId: access.userId };

  const deliveryNoteNumber = body.deliveryNoteNumber ?? '';
  const { destinationLocationId, batchNumber, lines } = body;

  // Validate destination
  await validateStockLocation(destinationLocationId);

  // Coarse check in router; authoritative check here
  assertCan(access, SMS_PERMISSIONS.RECEIVING_MANAGE, destinationLocationId);

  // Server-side duplicate VIN check in the payload
  const vinsSeen = new Set<string>();
  const duplicates: string[] = [];
  for (const line of lines) {
    const v = line.vin.trim().toUpperCase();
    if (vinsSeen.has(v)) duplicates.push(v);
    vinsSeen.add(v);
  }
  if (duplicates.length > 0) {
    throw new AppError(
      422,
      'SMS_DUPLICATE_VIN_IN_PAYLOAD',
      'Payload contains duplicate VINs',
      duplicates.map((v) => ({ vin: v })),
    );
  }

  const { body: result } = await runIdempotent<ConfirmResponse>(
    {
      key: idempotencyKey,
      userId: actor.userId,
      operation: 'shipments.confirm-import',
      payload: body,
      statusCode: 201,
      transaction: { timeout: 60_000 },
    },
    async (tx) => {
      // Find or create the shipment
      let shipment = await tx.smsShipment.findUnique({
        where: {
          destinationLocationId_batchNumber_deliveryNoteNumber: {
            destinationLocationId,
            batchNumber,
            deliveryNoteNumber,
          },
        },
      });

      if (!shipment) {
        shipment = await tx.smsShipment.create({
          data: {
            destinationLocationId,
            batchNumber,
            deliveryNoteNumber,
            originLocationId: body.originLocationId ?? null,
            dispatchDate: body.dispatchDate ? new Date(`${body.dispatchDate}T00:00:00.000Z`) : null,
            notes: body.notes ?? null,
            sourceFileName: body.sourceFileName ?? null,
            columnMapping: body.columnMapping
              ? (body.columnMapping as Prisma.InputJsonValue)
              : undefined,
            createdByUserId: actor.userId,
          },
        });
      }

      const allVins = lines.map((l) => l.vin.trim().toUpperCase());

      // Which VINs already exist in THIS shipment?
      const existing = await tx.smsShipmentLine.findMany({
        where: { shipmentId: shipment.id, vin: { in: allVins } },
        select: { vin: true },
      });
      const existingInShipment = new Set(existing.map((l) => l.vin));

      // Which VINs exist in OTHER shipments?
      const inOther = await tx.smsShipmentLine.findMany({
        where: { vin: { in: allVins }, shipmentId: { not: shipment.id } },
        select: { vin: true },
      });
      const existingElsewhere = new Set(inOther.map((l) => l.vin));

      // Which VINs are already received units?
      const existingUnits = await tx.smsUnit.findMany({
        where: { vin: { in: allVins } },
        select: { vin: true },
      });
      const alreadyUnits = new Set(existingUnits.map((u) => u.vin));

      const toCreate: Prisma.SmsShipmentLineCreateManyInput[] = [];
      const skipped: SkippedVin[] = [];

      for (const line of lines) {
        const vin = line.vin.trim().toUpperCase();

        if (existingInShipment.has(vin)) {
          skipped.push({ vin, reason: 'VIN already listed in this shipment' });
          continue;
        }
        if (existingElsewhere.has(vin)) {
          skipped.push({ vin, reason: 'VIN already listed in another shipment' });
          continue;
        }
        if (alreadyUnits.has(vin)) {
          skipped.push({ vin, reason: 'VIN already exists as a received unit' });
          continue;
        }

        toCreate.push({
          shipmentId: shipment.id,
          vin,
          engineNumber: line.engineNumber ?? null,
          variantId: line.variantId ?? null,
          rawModel: line.rawModel ?? null,
          rawVariant: line.rawVariant ?? null,
          rawColor: line.rawColor ?? null,
          sourceRows: line.sourceRows as Prisma.InputJsonValue,
          isExpected: true,
          receiptStatus: 'PENDING',
        });
      }

      if (toCreate.length > 0) {
        await tx.smsShipmentLine.createMany({ data: toCreate });
      }

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'IMPORT',
        resourceType: 'SmsShipment',
        resourceId: shipment.id,
        newValues: {
          batchNumber,
          deliveryNoteNumber,
          destinationLocationId,
          createdCount: toCreate.length,
          skippedCount: skipped.length,
        },
      });

      return {
        shipment: {
          id: shipment.id,
          batchNumber: shipment.batchNumber,
          deliveryNoteNumber: shipment.deliveryNoteNumber,
        },
        createdCount: toCreate.length,
        skipped,
      };
    },
  );

  return result;
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listShipments(
  query: {
    destinationLocationId?: string;
    state?: 'open' | 'complete' | 'all';
    search?: string;
    page: number;
    limit: number;
  },
  req: Request,
): Promise<{ data: ShipmentListItem[]; meta: ReturnType<typeof buildPaginationMeta> }> {
  const access = requiredAccess(req);
  const scope = locationScope(access, SMS_PERMISSIONS.STOCK_VIEW);

  const destinationIds = scope;

  if (destinationIds !== 'ALL' && destinationIds.length === 0) {
    return { data: [], meta: buildPaginationMeta(query.page, query.limit, 0) };
  }

  const skip = (query.page - 1) * query.limit;

  const { shipments, total } = await repo.listShipments({
    destinationIds,
    destinationLocationId: query.destinationLocationId,
    state: query.state ?? 'all',
    search: query.search,
    skip,
    take: query.limit,
  });

  if (shipments.length === 0) {
    return { data: [], meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  const ids = shipments.map((s) => s.id);
  const countMap = await repo.getShipmentCounts(ids);

  const data: ShipmentListItem[] = shipments.map((s) => {
    const counts = countMap.get(s.id) ?? {
      expected: 0, receivedOk: 0, receivedDamaged: 0, discrepancy: 0, pending: 0,
    };
    return {
      id: s.id,
      batchNumber: s.batchNumber,
      deliveryNoteNumber: s.deliveryNoteNumber,
      destinationLocationId: s.destinationLocationId,
      destinationName: s.destinationLocation.name,
      originLocationId: s.originLocationId,
      originName: s.originLocation?.name ?? null,
      dispatchDate: s.dispatchDate,
      notes: s.notes,
      createdAt: s.createdAt,
      counts,
    };
  });

  return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
}

// ── Get detail ────────────────────────────────────────────────────────────────

export async function getShipment(id: string, req: Request): Promise<ShipmentDetail> {
  const access = requiredAccess(req);
  const shipment = await repo.findShipmentById(id);

  if (!shipment) {
    throw new AppError(404, 'SMS_SHIPMENT_NOT_FOUND', 'Shipment not found');
  }

  // A shipment the caller may not see is reported as missing, so its
  // existence (and batch number) is not revealed.
  if (!can(access, SMS_PERMISSIONS.STOCK_VIEW, shipment.destinationLocationId)) {
    throw new AppError(404, 'SMS_SHIPMENT_NOT_FOUND', 'Shipment not found');
  }

  const lines = await repo.findLinesByShipmentId(id);
  const countMap = await repo.getShipmentCounts([id]);
  const counts = countMap.get(id) ?? {
    expected: 0, receivedOk: 0, receivedDamaged: 0, discrepancy: 0, pending: 0,
  };

  return {
    id: shipment.id,
    batchNumber: shipment.batchNumber,
    deliveryNoteNumber: shipment.deliveryNoteNumber,
    destinationLocationId: shipment.destinationLocationId,
    destinationName: shipment.destinationLocation.name,
    originLocationId: shipment.originLocationId,
    originName: shipment.originLocation?.name ?? null,
    dispatchDate: shipment.dispatchDate,
    notes: shipment.notes,
    sourceFileName: shipment.sourceFileName,
    createdAt: shipment.createdAt,
    createdByName: shipment.createdBy.name,
    counts,
    lines: lines.map((l) => ({
      id: l.id,
      vin: l.vin,
      engineNumber: l.engineNumber,
      variantId: l.variantId,
      variantName: l.variant?.name ?? null,
      modelCode: l.variant?.model.code ?? null,
      modelName: l.variant?.model.name ?? null,
      rawModel: l.rawModel,
      rawVariant: l.rawVariant,
      rawColor: l.rawColor,
      sourceRows: l.sourceRows,
      isExpected: l.isExpected,
      receiptStatus: l.receiptStatus,
      discrepancyNotes: l.discrepancyNotes,
      receivedAt: l.receivedAt,
      receivedByName: l.receivedBy?.name ?? null,
      unit: l.unit ? { id: l.unit.id, status: l.unit.status } : null,
    })),
  };
}

// ── Receive ───────────────────────────────────────────────────────────────────

export async function receiveItems(
  shipmentId: string,
  body: ReceiveBody,
  req: Request,
): Promise<ReceiveResponse> {
  const access = requiredAccess(req);
  const idempotencyKey = requireIdempotencyKey(req);
  const actor = { userId: access.userId };

  // Load shipment FIRST to get the authoritative destination
  const shipment = await repo.findShipmentById(shipmentId);
  if (!shipment) {
    throw new AppError(404, 'SMS_SHIPMENT_NOT_FOUND', 'Shipment not found');
  }

  // Authoritative location check using the shipment's destination
  assertCan(access, SMS_PERMISSIONS.RECEIVING_MANAGE, shipment.destinationLocationId);

  const eventDate = resolveEventDate(body.eventDate);

  const { body: result } = await runIdempotent<ReceiveResponse>(
    {
      key: idempotencyKey,
      userId: actor.userId,
      operation: 'shipments.receive',
      payload: { shipmentId, ...body },
      transaction: { timeout: 30_000 },
    },
    async (tx) => {
      const lineIds = body.items.map((i) => i.lineId);

      // Lock lines FOR UPDATE in sorted order
      await repo.lockLines(tx, lineIds);
      const lockedLines = await repo.findLockedLines(tx, lineIds);
      const lineMap = new Map(lockedLines.map((l) => [l.id, l]));

      // Validate all items before writing anything (fail-fast)
      const perItemErrors: Array<{ lineId: string; reason: string }> = [];

      for (const item of body.items) {
        const line = lineMap.get(item.lineId);
        if (!line) {
          perItemErrors.push({ lineId: item.lineId, reason: 'Line not found' });
          continue;
        }
        if (line.shipmentId !== shipmentId) {
          perItemErrors.push({ lineId: item.lineId, reason: 'Line does not belong to this shipment' });
          continue;
        }
        // Already-received is not an error — handled below
        if (line.receiptStatus === 'PENDING' || line.receiptStatus === 'RECEIVED_OK' || line.receiptStatus === 'RECEIVED_DAMAGED') {
          // OK to process
        }
        // Variant must be resolvable
        const resolvedVariantId = item.variantId ?? line.variantId;
        if (line.receiptStatus === 'PENDING' && !resolvedVariantId) {
          perItemErrors.push({
            lineId: item.lineId,
            reason: `VIN ${line.vin}: variantId is required but was not provided and is not set on the line`,
          });
        }
      }

      if (perItemErrors.length > 0) {
        throw new AppError(
          422,
          'SMS_RECEIVE_VALIDATION_FAILED',
          'Some items could not be received',
          perItemErrors,
        );
      }

      const received: ReceiveResponse['received'] = [];
      const alreadyReceived: ReceiveResponse['alreadyReceived'] = [];

      for (const item of body.items) {
        const line = lineMap.get(item.lineId)!;

        // Already received → replay-safe: return existing unit
        if (line.receiptStatus !== 'PENDING') {
          if (line.unitId) {
            const unit = await tx.smsUnit.findUnique({ where: { id: line.unitId } });
            if (unit) {
              alreadyReceived.push({
                lineId: line.id,
                unit: { id: unit.id, vin: unit.vin, status: unit.status },
              });
            }
          }
          continue;
        }

        const resolvedVariantId = item.variantId ?? line.variantId!;
        const eventType = item.condition === 'DAMAGED' ? 'RECEIPT_DAMAGED' : 'RECEIPT_OK';

        const { unit } = await createUnitWithEvent(
          tx,
          {
            vin: line.vin,
            engineNumber: item.engineNumber ?? line.engineNumber ?? undefined,
            variantId: resolvedVariantId,
            shipmentId: shipment.id,
            receivedAt: eventDate,
            createdByUserId: actor.userId,
          },
          {
            event: { type: eventType, locationId: shipment.destinationLocationId },
            eventDate,
            performedByUserId: actor.userId,
            links: { shipmentLineId: line.id },
          },
        );

        // Update the shipment line
        const newStatus = item.condition === 'DAMAGED' ? 'RECEIVED_DAMAGED' : 'RECEIVED_OK';
        await repo.updateLine(tx, line.id, {
          receiptStatus: newStatus,
          unitId: unit.id,
          receivedByUserId: actor.userId,
          receivedAt: eventDate,
          ...(item.engineNumber && { engineNumber: item.engineNumber }),
          ...(item.variantId && { variantId: item.variantId }),
        });

        // For DAMAGED: create an inspection and record INSPECTION_STARTED
        if (item.condition === 'DAMAGED') {
          const inspection = await repo.createInspection(tx, {
            unitId: unit.id,
            reason: 'RECEIPT_DAMAGE',
            findings: item.damageNotes ?? null,
            createdByUserId: actor.userId,
          });

          await recordUnitEvent(tx, unit, {
            event: { type: 'INSPECTION_STARTED' },
            eventDate,
            performedByUserId: actor.userId,
            links: { shipmentLineId: line.id, inspectionId: inspection.id },
          });
        }

        await createAuditLog(tx, {
          userId: actor.userId,
          action: 'CREATE',
          resourceType: 'SmsUnit',
          resourceId: unit.id,
          newValues: { vin: unit.vin, status: unit.status, shipmentId: shipment.id },
        });

        received.push({
          lineId: line.id,
          unit: { id: unit.id, vin: unit.vin, status: unit.status },
        });
      }

      // Recompute counts inside the transaction so they include this receipt.
      const countMap = await repo.getShipmentCounts([shipmentId], tx);
      const counts = countMap.get(shipmentId) ?? {
        expected: 0, receivedOk: 0, receivedDamaged: 0, discrepancy: 0, pending: 0,
      };

      return { received, alreadyReceived, counts };
    },
  );

  return result;
}

// ── Findings ──────────────────────────────────────────────────────────────────

export async function recordFinding(
  shipmentId: string,
  body: FindingsBody,
  req: Request,
): Promise<FindingsResponse> {
  const access = requiredAccess(req);
  const idempotencyKey = requireIdempotencyKey(req);
  const actor = { userId: access.userId };

  const shipment = await repo.findShipmentById(shipmentId);
  if (!shipment) {
    throw new AppError(404, 'SMS_SHIPMENT_NOT_FOUND', 'Shipment not found');
  }

  assertCan(access, SMS_PERMISSIONS.RECEIVING_MANAGE, shipment.destinationLocationId);

  const eventDate = resolveEventDate(body.eventDate);
  const vin = body.vin.trim().toUpperCase();

  const { body: result } = await runIdempotent<FindingsResponse>(
    {
      key: idempotencyKey,
      userId: actor.userId,
      operation: 'shipments.record-finding',
      payload: { shipmentId, ...body },
    },
    async (tx) => {
      // Create the unit with IDENTITY_MISMATCH_FOUND
      const { unit } = await createUnitWithEvent(
        tx,
        {
          vin,
          engineNumber: body.engineNumber ?? undefined,
          variantId: body.variantId,
          shipmentId: shipment.id,
          receivedAt: eventDate,
          createdByUserId: actor.userId,
        },
        {
          event: { type: 'IDENTITY_MISMATCH_FOUND', locationId: shipment.destinationLocationId },
          eventDate,
          performedByUserId: actor.userId,
          notes: body.notes,
        },
      );

      let line: { id: string; receiptStatus: string };
      let isNewLine = false;

      if (body.lineId) {
        // Lock and update the expected line
        await repo.lockLines(tx, [body.lineId]);
        const existing = await tx.smsShipmentLine.findUnique({ where: { id: body.lineId } });
        if (!existing || existing.shipmentId !== shipmentId) {
          throw new AppError(404, 'SMS_LINE_NOT_FOUND', 'Shipment line not found');
        }
        await repo.updateLine(tx, body.lineId, {
          receiptStatus: 'DISCREPANCY',
          unitId: unit.id,
          discrepancyNotes: body.notes,
          receivedByUserId: actor.userId,
          receivedAt: eventDate,
        });
        line = { id: body.lineId, receiptStatus: 'DISCREPANCY' };
      } else {
        // Create a new unexpected line
        const newLine = await repo.createLine(tx, {
          shipmentId: shipment.id,
          vin,
          engineNumber: body.engineNumber ?? null,
          variantId: body.variantId,
          sourceRows: [] as Prisma.InputJsonValue,
          isExpected: false,
          receiptStatus: 'DISCREPANCY',
          unitId: unit.id,
          discrepancyNotes: body.notes,
          receivedByUserId: actor.userId,
          receivedAt: eventDate,
        });
        line = { id: newLine.id, receiptStatus: 'DISCREPANCY' };
        isNewLine = true;
      }

      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'CREATE',
        resourceType: 'SmsUnit',
        resourceId: unit.id,
        newValues: { vin: unit.vin, status: unit.status, finding: true, shipmentId: shipment.id },
      });

      return {
        unit: { id: unit.id, vin: unit.vin, status: unit.status },
        line,
        isNewLine,
      };
    },
  );

  return result;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function validateStockLocation(locationId: string): Promise<void> {
  const loc = await repo.findDestinationLocation(locationId);
  if (!loc) {
    throw new AppError(422, 'SMS_LOCATION_NOT_FOUND', `Location ${locationId} not found`);
  }
  if (!loc.isActive) {
    throw new AppError(422, 'SMS_LOCATION_INACTIVE', 'The destination location is inactive');
  }
  const allowed = SMS_STOCK_LOCATION_TYPES as readonly string[];
  if (!allowed.includes(loc.type)) {
    throw new AppError(
      422,
      'SMS_INVALID_LOCATION_TYPE',
      `Location type "${loc.type}" cannot hold stock. Must be one of: ${SMS_STOCK_LOCATION_TYPES.join(', ')}`,
    );
  }
}
