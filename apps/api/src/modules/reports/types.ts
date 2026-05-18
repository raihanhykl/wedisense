import type { ReportType, ReportStatus, ReportSchedule } from '@prisma/client';

export type ReportParameters = Record<string, unknown>;

export interface ReportDto {
  id: string;
  name: string;
  type: ReportType;
  status: ReportStatus;
  parameters: ReportParameters;
  schedule: ReportSchedule | null;
  lastGeneratedAt: Date | null;
  fileUrl: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerateReportJobPayload {
  reportId: string;
  format: 'excel' | 'pdf';
}
