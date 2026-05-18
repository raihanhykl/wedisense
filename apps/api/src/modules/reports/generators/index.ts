import type { ReportType } from '@prisma/client';
import type { ReportParameters } from '../types.js';
import { generateAssetListReport } from './asset-list.generator.js';
import { generateMovementReport } from './movement.generator.js';
import { generateMaintenanceReport } from './maintenance.generator.js';
import { generateDepreciationReport } from './depreciation.generator.js';
import { generateAuditReport } from './audit.generator.js';

export async function generateReport(
  type: ReportType,
  format: 'excel' | 'pdf',
  parameters: ReportParameters,
): Promise<Buffer> {
  switch (type) {
    case 'ASSET_LIST':
      return generateAssetListReport(parameters, format);
    case 'MOVEMENT':
      return generateMovementReport(parameters, format);
    case 'MAINTENANCE':
      return generateMaintenanceReport(parameters, format);
    case 'DEPRECIATION':
      return generateDepreciationReport(parameters, format);
    case 'AUDIT':
      return generateAuditReport(parameters, format);
    case 'CUSTOM':
      // CUSTOM falls through to ASSET_LIST as a sensible default
      return generateAssetListReport(parameters, format);
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown report type: ${String(_exhaustive)}`);
    }
  }
}
