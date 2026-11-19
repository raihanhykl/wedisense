/**
 * Business logic for the opening-balance slice.
 *
 * Three-step flow: inspect → preview → confirm, mirroring the shipments slice.
 * Confirm uses runIdempotent → smsTransaction and createUnitWithEvent for
 * every unit.
 *
 * Key invariant (spec acceptance scenario A14): ACTIVE_RTO units do NOT get
 * an SmsOrder / SmsOrderLine. Only the SmsRtoContract is created, with
 * orderLineId null and isOpeningBalance true.
 */
import ExcelJS from 'exceljs';
import { SMS_PERMISSIONS, SMS_STOCK_LOCATION_TYPES } from '@wedisense/shared';
import { AppError } from '../../../middleware/error-handler.js';
import {
  getSmsAccess,
  assertCan,
} from '../lib/access.js';
import {
  businessToday,
  createUnitWithEvent,
  recordUnitEvent,
  resolveEventDate,
} from '../lib/ledger.js';
import { requireIdempotencyKey, runIdempotent } from '../lib/idempotency.js';
import { createAuditLog } from '../lib/audit.js';
import {
  listWorkbookSheets,
  readSheetRows,
  parseDelimitedText,
  detectHeaderRow,
  suggestColumnMapping,
} from '../lib/tabular.js';
import * as repo from './repository.js';
import { validateRow, matchVariant } from './row-validator.js';
import type { Request } from 'express';
import type {
  ObInspectResponse,
  ObPreviewResponse,
  ObPreviewRow,
  ObConfirmResponse,
} from './types.js';
import type { ObPreviewOptions, ObConfirmBody, ObConfirmRow } from './schema.js';
import type { RawObRow, LookupMaps } from './row-validator.js';

// ── Field synonyms for opening-balance columns ───────────────────────────────

export const OB_FIELD_SYNONYMS: Record<string, string[]> = {
  vin: [
    'nomor rangka', 'no rangka', 'no. rangka', 'vin', 'chassis', 'chassis no',
    'chassis number', 'frame no', 'frame number', 'nomor sasis', 'no sasis',
  ],
  engineNumber: [
    'nomor mesin', 'no mesin', 'no. mesin', 'engine no', 'engine number', 'nomesin',
  ],
  licensePlate: [
    'nomor plat', 'no plat', 'plat nomor', 'nopol', 'license plate', 'plate number',
    'nomor polisi',
  ],
  model: ['model', 'tipe', 'type', 'vehicle model'],
  variant: ['varian', 'variant', 'tipe kendaraan'],
  color: ['warna', 'color', 'colour'],
  state: [
    'kondisi', 'status', 'state', 'kondisi unit', 'unit state', 'unit status',
  ],
  showroom: ['showroom', 'cabang', 'branch', 'lokasi', 'location', 'kode cabang'],
  notes: ['catatan', 'notes', 'keterangan', 'note'],
  spkNumber: ['nomor spk', 'no spk', 'spk', 'spk number', 'no. spk', 'nomor pesanan'],
  customerName: ['nama pelanggan', 'customer', 'customer name', 'nama customer', 'nama pembeli'],
  customerPhone: ['telp pelanggan', 'hp pelanggan', 'customer phone', 'no telp'],
  sales: ['sales', 'salesperson', 'nama sales', 'karyawan sales'],
  contractNumber: ['nomor kontrak', 'no kontrak', 'contract number', 'contract no', 'no. kontrak'],
  contractStartDate: ['tanggal kontrak', 'contract start', 'contract start date', 'tanggal mulai kontrak'],
  eventName: ['nama event', 'event name', 'nama pameran', 'event'],
  eventLocation: ['lokasi event', 'event location', 'tempat pameran'],
  expectedReturnDate: ['tanggal kembali', 'expected return', 'expected return date', 'tgl kembali'],
  pic: ['pic', 'penanggung jawab', 'in charge', 'nama pic'],
  heldAtShowroom: ['showroom titipan', 'held at', 'dititip di', 'titip showroom'],
};

// ── Source parsing (shared with shipments) ────────────────────────────────────

type FileSource = { kind: 'file'; buffer: Buffer; mime: string; fileName: string; sheetName?: string };
type TextSource = { kind: 'text'; text: string };

async function parseSourceToRows(source: FileSource | TextSource): Promise<{
  rows: string[][];
  sheets: Array<{ name: string; rowCount: number }>;
  selectedSheet: string;
}> {
  if (source.kind === 'text') {
    const rows = parseDelimitedText(source.text);
    return { rows, sheets: [{ name: 'Pasted Data', rowCount: rows.length }], selectedSheet: 'Pasted Data' };
  }

  const { mime, buffer, sheetName } = source;

  if (mime === 'text/csv') {
    const rows = parseDelimitedText(buffer.toString('utf8'));
    return { rows, sheets: [{ name: 'CSV', rowCount: rows.length }], selectedSheet: 'CSV' };
  }

  const sheets = await listWorkbookSheets(buffer);
  const resolved = sheetName ?? sheets[0]?.name ?? '';
  const rows = await readSheetRows(buffer, sheetName);

  return { rows, sheets, selectedSheet: resolved };
}

// ── Inspect ───────────────────────────────────────────────────────────────────

export async function inspectSource(source: FileSource | TextSource): Promise<ObInspectResponse> {
  const { rows, sheets, selectedSheet } = await parseSourceToRows(source);
  const headerRowIndex = detectHeaderRow(rows, OB_FIELD_SYNONYMS);
  const headerRow = rows[headerRowIndex] ?? [];
  const dataRows = rows.slice(headerRowIndex + 1, headerRowIndex + 11);
  const suggestedMapping = suggestColumnMapping(headerRow, OB_FIELD_SYNONYMS);

  return {
    source: source.kind === 'file' ? { kind: 'file', fileName: source.fileName } : { kind: 'text' },
    sheets,
    sheet: { name: selectedSheet, headerRowIndex, headers: headerRow, sampleRows: dataRows, suggestedMapping },
  };
}

// ── Shared: build raw row from cells + mapping ────────────────────────────────

type FieldMapping = Record<string, number | null>;

function getCell(cells: string[], mapping: FieldMapping, field: string): string {
  const col = mapping[field];
  if (col === null || col === undefined) return '';
  return cells[col] ?? '';
}

function extractRawRows(rows: string[][], headerRowIndex: number, mapping: FieldMapping): RawObRow[] {
  const dataRows = rows.slice(headerRowIndex + 1);
  const result: RawObRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i] ?? [];
    if (cells.every((c) => c.trim() === '')) continue;

    const sheetRow = headerRowIndex + i + 2;
    result.push({
      row: sheetRow,
      vin: getCell(cells, mapping, 'vin'),
      engineNumber: getCell(cells, mapping, 'engineNumber'),
      licensePlate: getCell(cells, mapping, 'licensePlate'),
      model: getCell(cells, mapping, 'model'),
      variant: getCell(cells, mapping, 'variant'),
      color: getCell(cells, mapping, 'color'),
      state: getCell(cells, mapping, 'state'),
      showroom: getCell(cells, mapping, 'showroom'),
      notes: getCell(cells, mapping, 'notes'),
      spkNumber: getCell(cells, mapping, 'spkNumber'),
      customerName: getCell(cells, mapping, 'customerName'),
      customerPhone: getCell(cells, mapping, 'customerPhone'),
      sales: getCell(cells, mapping, 'sales'),
      contractNumber: getCell(cells, mapping, 'contractNumber'),
      contractStartDate: getCell(cells, mapping, 'contractStartDate'),
      eventName: getCell(cells, mapping, 'eventName'),
      eventLocation: getCell(cells, mapping, 'eventLocation'),
      expectedReturnDate: getCell(cells, mapping, 'expectedReturnDate'),
      pic: getCell(cells, mapping, 'pic'),
      heldAtShowroom: getCell(cells, mapping, 'heldAtShowroom'),
    });
  }

  return result;
}

// ── Shared: build lookup maps (used by both preview and confirm) ──────────────

async function buildLookupMaps(_vins: string[]): Promise<Omit<LookupMaps, 'existingVins' | 'existingSpkKeys' | 'existingContractNumbers'>> {
  const [variants, users, showrooms] = await Promise.all([
    repo.findAllVariantsForMatching(),
    repo.findActiveUsersForMatching(),
    repo.findActiveStockShowrooms(),
  ]);
  return { variants, users, showrooms };
}

// ── Preview ───────────────────────────────────────────────────────────────────

export async function previewBalance(
  source: FileSource | TextSource,
  options: ObPreviewOptions,
  req: Request,
): Promise<ObPreviewResponse> {
  const access = getSmsAccess(req);

  // If a showroomId is given, validate it and check access
  if (options.showroomId) {
    const loc = await repo.findStockLocation(options.showroomId);
    validateStockLocationRow(loc, options.showroomId);
    assertCan(access, SMS_PERMISSIONS.RECEIVING_MANAGE, options.showroomId);
  }

  const { rows } = await parseSourceToRows(source);
  const rawRows = extractRawRows(rows, options.headerRowIndex, options.mapping);

  const allVins = rawRows.map((r) => r.vin.trim().toUpperCase()).filter(Boolean);

  const [baseMaps, existingUnitVins, pendingShipmentVins] = await Promise.all([
    buildLookupMaps(allVins),
    repo.findExistingUnitVins(allVins),
    repo.findPendingShipmentVins(allVins),
  ]);

  // Collect SPK candidates and contract numbers for conflict detection
  const allContracts: string[] = [];
  for (const r of rawRows) {
    if (r.contractNumber.trim()) allContracts.push(r.contractNumber.trim());
  }

  const [existingSpkKeys, existingContractNumbers] = await Promise.all([
    repo.findExistingSpkKeys([]), // scanned row-by-row below
    repo.findExistingContractNumbers(allContracts),
  ]);

  const existingVins = new Set([...existingUnitVins, ...pendingShipmentVins]);

  const maps: LookupMaps = {
    ...baseMaps,
    existingVins,
    existingSpkKeys,
    existingContractNumbers,
  };

  const balanceDate = options.balanceDate ?? toIsoDate(businessToday());
  const defaultShowroomId = options.showroomId ?? null;

  const seenVins = new Set<string>();
  const seenSpkKeys = new Set<string>();
  const seenContracts = new Set<string>();

  const previewRows: ObPreviewRow[] = [];

  for (const raw of rawRows) {
    const previewRow = validateRow(raw, maps, {
      defaultShowroomId,
      balanceDate,
      seenVinsInFile: seenVins,
      seenSpkKeysInFile: seenSpkKeys,
      seenContractNumbersInFile: seenContracts,
    });
    previewRows.push(previewRow);
  }

  // Build summary
  const byState: Record<string, number> = {};
  let errorCount = 0;
  let warningCount = 0;
  for (const r of previewRows) {
    if (r.state) {
      byState[r.state] = (byState[r.state] ?? 0) + 1;
    }
    errorCount += r.errors.length;
    warningCount += r.warnings.length;
  }

  // Build unmatched variants list
  const unmatchedVariants: ObPreviewResponse['unmatchedVariants'] = [];
  const unmatchedMap = new Map<string, { rawModel: string | null; rawVariant: string | null; rawColor: string | null; count: number }>();
  for (const raw of rawRows) {
    if (!raw.model.trim() && !raw.variant.trim() && !raw.color.trim()) continue;
    // Check if this combination went unmatched
    const matched = matchVariant(baseMaps.variants, raw.model, raw.variant, raw.color);
    if (!matched) {
      const key = `${raw.model}|${raw.variant}|${raw.color}`;
      const entry = unmatchedMap.get(key);
      if (entry) {
        entry.count++;
      } else {
        unmatchedMap.set(key, {
          rawModel: raw.model.trim() || null,
          rawVariant: raw.variant.trim() || null,
          rawColor: raw.color.trim() || null,
          count: 1,
        });
      }
    }
  }
  for (const v of unmatchedMap.values()) {
    unmatchedVariants.push(v);
  }

  return {
    rows: previewRows,
    summary: { total: previewRows.length, errorCount, warningCount, byState },
    unmatchedVariants,
  };
}

// ── Confirm ───────────────────────────────────────────────────────────────────

export async function confirmBalance(
  body: ObConfirmBody,
  req: Request,
): Promise<ObConfirmResponse> {
  const access = getSmsAccess(req);
  const idempotencyKey = requireIdempotencyKey(req);
  const actor = { userId: access.userId };

  // Resolve balance date
  const balanceDate = resolveEventDate(body.balanceDate);

  // Collect all showroom ids and validate access
  const showroomIds = new Set(body.rows.map((r) => r.showroomId));
  for (const sid of showroomIds) {
    const loc = await repo.findStockLocation(sid);
    validateStockLocationRow(loc, sid);
    assertCan(access, SMS_PERMISSIONS.RECEIVING_MANAGE, sid);
  }

  // Server-side re-validation
  const allVins = body.rows.map((r) => r.vin.trim().toUpperCase());

  // Duplicate VINs in payload
  const vinsSeen = new Set<string>();
  const duplicates: string[] = [];
  for (const v of allVins) {
    if (vinsSeen.has(v)) duplicates.push(v);
    vinsSeen.add(v);
  }
  if (duplicates.length > 0) {
    throw new AppError(
      422, 'SMS_DUPLICATE_VIN_IN_PAYLOAD',
      'Payload contains duplicate VINs',
      duplicates.map((v) => ({ vin: v })),
    );
  }

  // Collect all contract numbers for in-payload duplicate check
  const contractsSeen = new Set<string>();
  const contractDupes: string[] = [];
  for (const row of body.rows) {
    if (row.contractNumber) {
      if (contractsSeen.has(row.contractNumber)) contractDupes.push(row.contractNumber);
      contractsSeen.add(row.contractNumber);
    }
  }
  if (contractDupes.length > 0) {
    throw new AppError(
      422, 'SMS_DUPLICATE_CONTRACT_IN_PAYLOAD',
      'Payload contains duplicate contract numbers',
      contractDupes.map((c) => ({ contractNumber: c })),
    );
  }

  // Load conflict-detection sets
  const spkCandidates = body.rows
    .filter((r) => r.spkNumber)
    .map((r) => ({ showroomId: r.showroomId, spkNumber: r.spkNumber! }));

  const contractNumbers = body.rows
    .filter((r) => r.contractNumber)
    .map((r) => r.contractNumber!);

  const [existingUnitVins, pendingShipmentVins, existingSpkKeys, existingContractNumbers] =
    await Promise.all([
      repo.findExistingUnitVins(allVins),
      repo.findPendingShipmentVins(allVins),
      repo.findExistingSpkKeys(spkCandidates),
      repo.findExistingContractNumbers(contractNumbers),
    ]);

  const existingVins = new Set([...existingUnitVins, ...pendingShipmentVins]);

  // Server-side per-row re-validation using same validator (no DB lookups
  // needed here because existingVins etc. are already loaded)
  const perRowErrors: Array<{ row: number; vin: string; field?: string; message: string }> = [];

  for (const row of body.rows) {
    const vin = row.vin.trim().toUpperCase();
    if (existingVins.has(vin)) {
      perRowErrors.push({ row: row.row, vin, field: 'vin', message: `VIN ${vin} is already registered` });
    }
    const spkKey = row.spkNumber ? `${row.showroomId}|${row.spkNumber}` : null;
    if (spkKey && existingSpkKeys.has(spkKey)) {
      perRowErrors.push({ row: row.row, vin, field: 'spkNumber', message: `SPK number "${row.spkNumber}" already exists for this showroom` });
    }
    if (row.contractNumber && existingContractNumbers.has(row.contractNumber)) {
      perRowErrors.push({ row: row.row, vin, field: 'contractNumber', message: `Contract number "${row.contractNumber}" already exists` });
    }
  }

  if (perRowErrors.length > 0) {
    throw new AppError(
      422, 'SMS_OPENING_BALANCE_VALIDATION_FAILED',
      'One or more rows failed server-side validation',
      perRowErrors,
    );
  }

  const { body: result } = await runIdempotent<ObConfirmResponse>(
    {
      key: idempotencyKey,
      userId: actor.userId,
      operation: 'opening-balance.confirm',
      payload: body,
      statusCode: 201,
      transaction: { timeout: 60_000 },
    },
    async (tx) => {
      let createdCount = 0;
      let ordersCreated = 0;
      let contractsCreated = 0;
      const byState: Record<string, number> = {};

      // Map (showroomId|spkNumber) → SmsOrder id — built per-transaction
      // so rows sharing an SPK share one order.
      const spkToOrderId = new Map<string, string>();

      for (const row of body.rows) {
        const vin = row.vin.trim().toUpperCase();
        const state = row.state;
        const showroomId = row.showroomId;

        // Determine physicalLocationId from state invariant
        const physicalLocationId = physicalLocationForState(state, showroomId, row.heldAtShowroomId);

        // Create the unit with the OPENING_BALANCE event (no pointer columns
        // yet — pointers are set after the related row is created).
        const { unit } = await createUnitWithEvent(
          tx,
          {
            vin,
            engineNumber: row.engineNumber ?? undefined,
            licensePlate: row.licensePlate ?? undefined,
            variantId: row.variantId,
            isOpeningBalance: true,
            receivedAt: null, // history not available
            notes: row.notes ?? undefined,
            createdByUserId: actor.userId,
          },
          {
            event: {
              type: 'OPENING_BALANCE',
              status: state,
              physicalLocationId,
              responsibleShowroomId: showroomId,
            },
            eventDate: balanceDate,
            performedByUserId: actor.userId,
          },
        );

        // ── BOOKED / SOLD_PENDING_PICKUP: create order + order line ──────────
        if (state === 'BOOKED' || state === 'SOLD_PENDING_PICKUP') {
          const spkKey = `${showroomId}|${row.spkNumber!}`;
          let orderId = spkToOrderId.get(spkKey);

          if (!orderId) {
            const order = await tx.smsOrder.create({
              data: {
                showroomId,
                spkNumber: row.spkNumber!,
                salesUserId: row.salesUserId ?? null,
                customerName: row.customerName!,
                customerPhone: row.customerPhone ?? null,
                isOpeningBalance: true,
                createdByUserId: actor.userId,
              },
            });
            orderId = order.id;
            spkToOrderId.set(spkKey, orderId);
            ordersCreated++;
          }

          const lineStatus = state === 'BOOKED' ? 'BOOKED' : 'SOLD';
          const orderLine = await tx.smsOrderLine.create({
            data: {
              orderId,
              unitId: unit.id,
              status: lineStatus,
              bookedAt: balanceDate,
              soldAt: state === 'SOLD_PENDING_PICKUP' ? balanceDate : null,
            } as Parameters<typeof tx.smsOrderLine.create>[0]['data'],
          });

          // Set pointer
          await tx.smsUnit.update({
            where: { id: unit.id },
            data: { activeOrderLineId: orderLine.id },
          });
        }

        // ── ACTIVE_RTO: create contract, NO order ────────────────────────────
        if (state === 'ACTIVE_RTO') {
          const contract = await tx.smsRtoContract.create({
            data: {
              contractNumber: row.contractNumber!,
              unitId: unit.id,
              originShowroomId: showroomId,
              orderLineId: null,
              salesUserId: row.salesUserId ?? null,
              customerName: row.customerName!,
              customerPhone: row.customerPhone ?? null,
              startDate: new Date(`${row.contractStartDate ?? toIsoDate(balanceDate)}T00:00:00.000Z`),
              isOpeningBalance: true,
              createdByUserId: actor.userId,
            },
          });

          await tx.smsUnit.update({
            where: { id: unit.id },
            data: { openRtoContractId: contract.id },
          });
          contractsCreated++;
        }

        // ── CUSTODY: create contract + return request ────────────────────────
        if (state === 'CUSTODY') {
          const contract = await tx.smsRtoContract.create({
            data: {
              contractNumber: row.contractNumber!,
              unitId: unit.id,
              originShowroomId: showroomId,
              orderLineId: null,
              salesUserId: row.salesUserId ?? null,
              customerName: row.customerName!,
              customerPhone: row.customerPhone ?? null,
              startDate: new Date(`${row.contractStartDate ?? toIsoDate(balanceDate)}T00:00:00.000Z`),
              isOpeningBalance: true,
              createdByUserId: actor.userId,
            },
          });
          contractsCreated++;

          const requestNumber = await repo.generateReturnRequestNumber(tx, balanceDate);
          const returnRequest = await tx.smsReturnRequest.create({
            data: {
              requestNumber,
              unitId: unit.id,
              rtoContractId: contract.id,
              fromShowroomId: showroomId,
              toShowroomId: row.heldAtShowroomId!,
              reason: 'Opening balance — in custody at cutover',
              requestedByUserId: actor.userId,
              decision: 'PENDING',
              custodyReceivedAt: balanceDate,
            },
          });

          await tx.smsUnit.update({
            where: { id: unit.id },
            data: {
              openRtoContractId: contract.id,
              openReturnRequestId: returnRequest.id,
            },
          });
        }

        // ── INSPECTION: create SmsInspection ────────────────────────────────
        if (state === 'INSPECTION') {
          const inspection = await tx.smsInspection.create({
            data: {
              unitId: unit.id,
              reason: 'OTHER',
              result: 'PENDING',
              notes: 'Opening balance',
              createdByUserId: actor.userId,
            },
          });
          // Goes through the ledger like every other unit event, so the
          // inspection shows on the VIN timeline exactly as it does for a
          // unit that was received damaged.
          await recordUnitEvent(tx, unit, {
            event: { type: 'INSPECTION_STARTED' },
            eventDate: balanceDate,
            performedByUserId: actor.userId,
            links: { inspectionId: inspection.id },
          });
        }

        // ── SHOW_UNIT: create SmsShowLoan ────────────────────────────────────
        if (state === 'SHOW_UNIT') {
          const showLoan = await tx.smsShowLoan.create({
            data: {
              unitId: unit.id,
              showroomId,
              eventName: row.eventName!,
              eventLocation: row.eventLocation!,
              picUserId: row.picUserId ?? null,
              dispatchedAt: balanceDate,
              expectedReturnDate: new Date(`${row.expectedReturnDate}T00:00:00.000Z`),
              createdByUserId: actor.userId,
            },
          });

          await tx.smsUnit.update({
            where: { id: unit.id },
            data: { openShowLoanId: showLoan.id },
          });
        }

        createdCount++;
        byState[state] = (byState[state] ?? 0) + 1;
      }

      // Single summary audit row
      await createAuditLog(tx, {
        userId: actor.userId,
        action: 'IMPORT',
        resourceType: 'SmsUnit',
        resourceId: 'bulk',
        newValues: {
          byState,
          createdCount,
          ordersCreated,
          contractsCreated,
          sourceFileName: body.sourceFileName ?? null,
        },
      });

      return { createdCount, byState, ordersCreated, contractsCreated };
    },
  );

  return result;
}

// ── Template download ─────────────────────────────────────────────────────────

interface TemplateColumn {
  header: string;
  key: string;
  width: number;
  required: boolean;
}

const TEMPLATE_COLUMNS: TemplateColumn[] = [
  { header: 'VIN / Nomor Rangka*', key: 'vin', width: 22, required: true },
  { header: 'Nomor Mesin', key: 'engineNumber', width: 20, required: false },
  { header: 'Nomor Polisi', key: 'licensePlate', width: 15, required: false },
  { header: 'Model', key: 'model', width: 20, required: false },
  { header: 'Varian', key: 'variant', width: 25, required: false },
  { header: 'Warna / Color', key: 'color', width: 18, required: false },
  { header: 'Kondisi / State*', key: 'state', width: 22, required: true },
  { header: 'Showroom', key: 'showroom', width: 20, required: false },
  { header: 'Catatan / Notes', key: 'notes', width: 30, required: false },
  { header: 'Nomor SPK', key: 'spkNumber', width: 20, required: false },
  { header: 'Nama Customer', key: 'customerName', width: 25, required: false },
  { header: 'HP Customer', key: 'customerPhone', width: 18, required: false },
  { header: 'Sales', key: 'sales', width: 20, required: false },
  { header: 'Nomor Kontrak', key: 'contractNumber', width: 22, required: false },
  { header: 'Tanggal Kontrak', key: 'contractStartDate', width: 18, required: false },
  { header: 'Nama Event', key: 'eventName', width: 25, required: false },
  { header: 'Lokasi Event', key: 'eventLocation', width: 25, required: false },
  { header: 'Tanggal Kembali', key: 'expectedReturnDate', width: 18, required: false },
  { header: 'PIC', key: 'pic', width: 20, required: false },
  { header: 'Showroom Titipan', key: 'heldAtShowroom', width: 22, required: false },
];

const EXAMPLE_ROWS: Array<Partial<Record<string, string>>> = [
  { vin: 'MH1JFB118NK000001', engineNumber: 'JFB1E-1000001', model: 'Model X', variant: 'Standard', color: 'Merah', state: 'siap', showroom: 'JKT-01' },
  { vin: 'MH1JFB118NK000002', model: 'Model X', variant: 'Standard', color: 'Putih', state: 'booking', showroom: 'JKT-01', spkNumber: 'SPK-001', customerName: 'Budi Santoso', customerPhone: '081234567890', sales: 'Ahmad' },
  { vin: 'MH1JFB118NK000003', model: 'Model X', variant: 'Pro', color: 'Hitam', state: 'terjual', showroom: 'JKT-01', spkNumber: 'SPK-002', customerName: 'Siti Rahayu', customerPhone: '082345678901', sales: 'Ahmad' },
  { vin: 'MH1JFB118NK000004', model: 'Model X', variant: 'Pro', color: 'Biru', state: 'rto aktif', showroom: 'JKT-01', contractNumber: 'KTR-001', customerName: 'Hendra Wijaya', customerPhone: '083456789012', sales: 'Budi', contractStartDate: '2025-01-01' },
  { vin: 'MH1JFB118NK000005', model: 'Model X', variant: 'Standard', color: 'Abu-abu', state: 'inspeksi', showroom: 'JKT-01' },
  { vin: 'MH1JFB118NK000006', model: 'Model X', variant: 'Pro', color: 'Hijau', state: 'pameran', showroom: 'JKT-01', eventName: 'IIMS 2025', eventLocation: 'JIExpo Kemayoran', expectedReturnDate: '2025-12-31' },
  { vin: 'MH1JFB118NK000007', model: 'Model X', variant: 'Standard', color: 'Kuning', state: 'titipan', showroom: 'JKT-01', contractNumber: 'KTR-002', customerName: 'Maya Sari', heldAtShowroom: 'BDG-01' },
];

export async function buildTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // ── Sheet 1: Data ──────────────────────────────────────────────────────────
  const dataSheet = workbook.addWorksheet('Opening Balance');
  dataSheet.columns = TEMPLATE_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));

  // Style header row
  const headerRow = dataSheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF1E3A5F' } },
    };
  });

  // Add example rows
  for (const ex of EXAMPLE_ROWS) {
    const rowData: Record<string, string> = {};
    for (const col of TEMPLATE_COLUMNS) {
      rowData[col.key] = ex[col.key] ?? '';
    }
    dataSheet.addRow(rowData);
  }

  // ── Sheet 2: Guide ─────────────────────────────────────────────────────────
  const guideSheet = workbook.addWorksheet('Guide');
  guideSheet.columns = [
    { header: 'Kolom', key: 'column', width: 25 },
    { header: 'Keterangan', key: 'description', width: 50 },
    { header: 'Wajib', key: 'required', width: 10 },
  ];

  const guideHeader = guideSheet.getRow(1);
  guideHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  });

  for (const col of TEMPLATE_COLUMNS) {
    guideSheet.addRow({
      column: col.header.replace('*', '').trim(),
      description: getColumnDescription(col.key),
      required: col.required ? 'Ya' : 'Tidak',
    });
  }

  guideSheet.addRow({});
  guideSheet.addRow({ column: '--- Nilai Kondisi / State ---' });
  const stateValues = [
    ['siap / ready / available', 'Unit tersedia di showroom'],
    ['booking / booked', 'Unit sudah dipesan — butuh Nomor SPK & Nama Customer'],
    ['terjual / sold / terjual belum diambil', 'Sudah terjual, belum diambil — butuh Nomor SPK & Nama Customer'],
    ['rto aktif / active rto', 'Aktif RTO — butuh Nomor Kontrak & Nama Customer'],
    ['inspeksi / inspection', 'Sedang dalam proses inspeksi'],
    ['pameran / show unit', 'Sedang dipamerkan — butuh Nama Event, Lokasi Event & Tanggal Kembali'],
    ['titipan / custody', 'Dititip di showroom lain — butuh Nomor Kontrak, Nama Customer & Showroom Titipan'],
  ];
  for (const [val, desc] of stateValues) {
    guideSheet.addRow({ column: val, description: desc });
  }

  // @ts-expect-error -- ExcelJS Buffer typing
  return workbook.xlsx.writeBuffer() as Promise<Buffer>;
}

function getColumnDescription(key: string): string {
  const descriptions: Record<string, string> = {
    vin: 'Nomor rangka kendaraan (17 karakter)',
    engineNumber: 'Nomor mesin kendaraan',
    licensePlate: 'Nomor plat polisi',
    model: 'Nama model (harus sesuai master produk)',
    variant: 'Nama varian (harus sesuai master produk)',
    color: 'Warna (harus sesuai master produk)',
    state: 'Kondisi unit saat cutover (lihat sheet Guide)',
    showroom: 'Kode atau nama showroom yang bertanggung jawab',
    notes: 'Catatan tambahan',
    spkNumber: 'Nomor SPK (wajib untuk BOOKED dan SOLD)',
    customerName: 'Nama customer (wajib untuk BOOKED, SOLD, RTO, CUSTODY)',
    customerPhone: 'Nomor HP customer',
    sales: 'Nama atau ID karyawan sales',
    contractNumber: 'Nomor kontrak RTO (wajib untuk RTO dan CUSTODY)',
    contractStartDate: 'Tanggal mulai kontrak (YYYY-MM-DD)',
    eventName: 'Nama event pameran (wajib untuk SHOW_UNIT)',
    eventLocation: 'Lokasi event (wajib untuk SHOW_UNIT)',
    expectedReturnDate: 'Tanggal rencana kembali (wajib untuk SHOW_UNIT, YYYY-MM-DD)',
    pic: 'Nama atau ID penanggung jawab event',
    heldAtShowroom: 'Kode atau nama showroom titipan (wajib untuk CUSTODY)',
  };
  return descriptions[key] ?? '';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Determine physicalLocationId based on state invariant.
 * - AVAILABLE, BOOKED, SOLD_PENDING_PICKUP, INSPECTION: responsible showroom
 * - ACTIVE_RTO, SHOW_UNIT: null (not in a showroom)
 * - CUSTODY: heldAtShowroomId (the showroom holding the motorcycle)
 */
function physicalLocationForState(
  state: ObConfirmRow['state'],
  showroomId: string,
  heldAtShowroomId: string | undefined,
): string | null {
  switch (state) {
    case 'AVAILABLE':
    case 'BOOKED':
    case 'SOLD_PENDING_PICKUP':
    case 'INSPECTION':
      return showroomId;
    case 'CUSTODY':
      return heldAtShowroomId ?? null;
    case 'ACTIVE_RTO':
    case 'SHOW_UNIT':
      return null;
  }
}

/** Validate that a location is a valid, active stock showroom. */
function validateStockLocationRow(
  loc: { id: string; type: string; isActive: boolean } | null,
  locationId: string,
): void {
  if (!loc) {
    throw new AppError(422, 'SMS_LOCATION_NOT_FOUND', `Location ${locationId} not found`);
  }
  if (!loc.isActive) {
    throw new AppError(422, 'SMS_LOCATION_INACTIVE', 'Location is inactive');
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
