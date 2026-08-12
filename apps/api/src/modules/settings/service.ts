import { Prisma, type CompanySetting } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { storage } from '../../lib/storage.js';
import type { UpdateCompanySettingInput } from './schema.js';

/**
 * Fallback used only when the settings row is somehow absent (a DB restored
 * from before this feature, or a seed that was never run). Returning a
 * usable default rather than throwing keeps PDF generation working — a BAST
 * with a placeholder letterhead beats no BAST at all.
 */
const FALLBACK: Omit<CompanySetting, 'id' | 'createdAt' | 'updatedAt' | 'updatedByUserId'> = {
  name: 'Wedison',
  address: null,
  city: null,
  province: null,
  postalCode: null,
  phone: null,
  email: null,
  website: null,
  logoUrl: null,
  documentCode: 'WDS',
  divisionCode: 'IT',
};

/**
 * Reads the single company settings row, creating it on first access if the
 * seed never ran. Idempotent and safe to call from any request path.
 */
export async function getCompanySetting(): Promise<CompanySetting> {
  const existing = await prisma.companySetting.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing;

  return prisma.companySetting.create({ data: { ...FALLBACK } });
}

export async function updateCompanySetting(
  input: UpdateCompanySettingInput,
  userId: string,
): Promise<CompanySetting> {
  const current = await getCompanySetting();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.companySetting.update({
      where: { id: current.id },
      data: { ...input, updatedByUserId: userId },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'CompanySetting',
        resourceId: updated.id,
        oldValues: current as unknown as Prisma.InputJsonValue,
        newValues: updated as unknown as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * PNG and JPEG only. The letterhead is drawn by pdfkit, which can embed
 * exactly these two formats — accepting SVG or WebP here would mean an
 * upload that succeeds but silently breaks every subsequent PDF.
 */
const LOGO_SIGNATURES: Array<{ ext: string; matches: (buf: Buffer) => boolean }> = [
  {
    ext: 'png',
    matches: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    ext: 'jpg',
    matches: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
];

export async function uploadCompanyLogo(
  buffer: Buffer,
  userId: string,
): Promise<CompanySetting> {
  if (buffer.length === 0) {
    throw new AppError(400, 'EMPTY_FILE', 'Uploaded logo is empty');
  }
  if (buffer.length > LOGO_MAX_BYTES) {
    throw new AppError(400, 'FILE_TOO_LARGE', 'Logo must be 2MB or smaller');
  }

  const signature = LOGO_SIGNATURES.find((s) => s.matches(buffer));
  if (!signature) {
    throw new AppError(
      400,
      'INVALID_LOGO_FORMAT',
      'Logo must be a PNG or JPEG image (checked by file content, not extension)',
    );
  }

  const current = await getCompanySetting();
  // Include the setting id in the filename so a future multi-tenant split
  // doesn't collide, and overwrite in place so old logos don't accumulate.
  const relativePath = `company/logo-${current.id}.${signature.ext}`;
  const url = await storage.save(relativePath, buffer);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.companySetting.update({
      where: { id: current.id },
      // Cache-buster: the path is stable across re-uploads, so without a
      // changing query string browsers keep serving the previous logo.
      data: { logoUrl: `${url}?v=${Date.now()}`, updatedByUserId: userId },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resourceType: 'CompanySetting',
        resourceId: updated.id,
        oldValues: { logoUrl: current.logoUrl } as unknown as Prisma.InputJsonValue,
        newValues: { logoUrl: updated.logoUrl } as unknown as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}
