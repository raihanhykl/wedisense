import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import * as repo from './repository.js';
import { generateLabelsPdf, savePrintPdf } from '../../lib/pdf.js';
import type { CreateTemplateInput, UpdateTemplateInput, CreatePrintJobInput } from './schema.js';
import type { AssetData, LabelField } from './types.js';

// ── List Templates ─────────────────────────────────────────────

export async function listTemplates() {
  return repo.findManyTemplates();
}

// ── Get Template ───────────────────────────────────────────────

export async function getTemplate(id: string) {
  const template = await repo.findTemplateById(id);
  if (!template) {
    throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Label template not found');
  }
  return template;
}

// ── Create Template ────────────────────────────────────────────

export async function createTemplate(input: CreateTemplateInput, userId: string) {
  // Atomic create + audit (Phase 16 Tier 6).
  return prisma.$transaction(async (tx) => {
    const template = await repo.createTemplate(
      {
        name: input.name,
        description: input.description ?? null,
        paperWidthMm: input.paperWidthMm,
        paperHeightMm: input.paperHeightMm,
        isDefault: input.isDefault,
        fields: input.fields as unknown as Prisma.InputJsonValue,
        createdBy: { connect: { id: userId } },
      },
      tx,
    );
    await tx.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resourceType: 'LabelTemplate',
        resourceId: template.id,
        newValues: { name: input.name },
      },
    });
    return template;
  });
}

// ── Update Template ────────────────────────────────────────────

export async function updateTemplate(id: string, input: UpdateTemplateInput, userId: string) {
  const existing = await repo.findTemplateById(id);
  if (!existing) {
    throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Label template not found');
  }

  const data: Prisma.LabelTemplateUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.paperWidthMm !== undefined) data.paperWidthMm = input.paperWidthMm;
  if (input.paperHeightMm !== undefined) data.paperHeightMm = input.paperHeightMm;
  if (input.isDefault !== undefined) data.isDefault = input.isDefault;
  if (input.fields !== undefined) data.fields = input.fields as unknown as Prisma.InputJsonValue;

  return prisma.$transaction(async (tx) => {
    const template = await repo.updateTemplate(id, data, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'LabelTemplate',
        resourceId: id,
        newValues: input as unknown as Prisma.InputJsonValue,
      },
    });
    return template;
  });
}

// ── Delete Template ────────────────────────────────────────────

export async function deleteTemplate(id: string, userId: string) {
  const existing = await repo.findTemplateById(id);
  if (!existing) {
    throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Label template not found');
  }

  await prisma.$transaction(async (tx) => {
    await repo.deleteTemplate(id, tx);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'DELETE',
        resourceType: 'LabelTemplate',
        resourceId: id,
        newValues: { name: existing.name },
      },
    });
  });
}

// ── Preview Template ───────────────────────────────────────────

export async function previewTemplate(templateId: string, assetId: string) {
  const template = await repo.findTemplateById(templateId);
  if (!template) {
    throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Label template not found');
  }

  const asset = await repo.findAssetById(assetId);
  if (!asset) {
    throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  }

  const assetData = mapAssetData(asset);
  const fields = template.fields as unknown as LabelField[];

  return generateLabelsPdf({
    paperWidthMm: template.paperWidthMm,
    paperHeightMm: template.paperHeightMm,
    fields,
    assets: [assetData],
    copiesPerAsset: 1,
  });
}

// ── Create Print Job ───────────────────────────────────────────

export async function createPrintJob(input: CreatePrintJobInput, userId: string) {
  const template = await repo.findTemplateById(input.templateId);
  if (!template) {
    throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Label template not found');
  }

  const assets = await repo.findAssetsByIds(input.assetIds);
  if (assets.length !== input.assetIds.length) {
    const foundIds = new Set(assets.map((a) => a.id));
    const missing = input.assetIds.filter((id) => !foundIds.has(id));
    throw new AppError(404, 'ASSETS_NOT_FOUND', `Assets not found: ${missing.join(', ')}`);
  }

  // Create the print job record with PROCESSING status
  const printJob = await repo.createPrintJob({
    labelTemplate: { connect: { id: input.templateId } },
    assetIds: input.assetIds as unknown as Prisma.InputJsonValue,
    copiesPerAsset: input.copiesPerAsset,
    status: 'PROCESSING',
    createdBy: { connect: { id: userId } },
  });

  try {
    // Generate the PDF
    const assetDataList = assets.map(mapAssetData);
    const fields = template.fields as unknown as LabelField[];

    const pdfBuffer = await generateLabelsPdf({
      paperWidthMm: template.paperWidthMm,
      paperHeightMm: template.paperHeightMm,
      fields,
      assets: assetDataList,
      copiesPerAsset: input.copiesPerAsset,
    });

    // Save PDF to storage
    const pdfUrl = savePrintPdf(printJob.id, pdfBuffer);

    // Update status to READY
    const updatedJob = await repo.updatePrintJob(printJob.id, {
      status: 'READY',
      pdfUrl,
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resourceType: 'PrintJob',
        resourceId: printJob.id,
        newValues: {
          templateId: input.templateId,
          assetCount: input.assetIds.length,
          copiesPerAsset: input.copiesPerAsset,
        },
      },
    });

    return updatedJob;
  } catch (error) {
    // Mark as failed
    await repo.updatePrintJob(printJob.id, { status: 'FAILED' });
    throw error;
  }
}

// ── Get Print Job ──────────────────────────────────────────────

export async function getPrintJob(id: string) {
  const printJob = await repo.findPrintJobById(id);
  if (!printJob) {
    throw new AppError(404, 'PRINT_JOB_NOT_FOUND', 'Print job not found');
  }
  return printJob;
}

// ── Helpers ────────────────────────────────────────────────────

type AssetWithRelations = Awaited<ReturnType<typeof repo.findAssetById>>;

function mapAssetData(asset: NonNullable<AssetWithRelations>): AssetData & { id: string } {
  return {
    id: asset.id,
    assetNumber: asset.assetNumber,
    serialNumber: asset.serialNumber ?? null,
    name: asset.name,
    location: asset.location.name,
    assignedTo: asset.assignedTo?.name ?? null,
    purchaseDate: asset.purchaseDate ? asset.purchaseDate.toISOString().split('T')[0]! : null,
    warrantyEndDate: asset.warrantyEndDate ? asset.warrantyEndDate.toISOString().split('T')[0]! : null,
    barcodeImageUrl: asset.barcodeImageUrl ?? null,
  };
}
