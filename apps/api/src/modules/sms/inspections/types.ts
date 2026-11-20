import type { SmsInspectionReason, SmsInspectionResult, SmsVehicleCondition, SmsUnitStatus } from '@prisma/client';

export interface InspectionPhoto {
  url: string;
  caption?: string | null;
}

export interface InspectionVariantSummary {
  modelName: string;
  variantName: string;
  color: string;
}

export interface InspectionUnitSummary {
  id: string;
  vin: string;
  status: SmsUnitStatus;
  variant: InspectionVariantSummary;
}

export interface InspectionInspector {
  id: string;
  name: string;
}

export interface InspectionRow {
  id: string;
  unitId: string;
  unit: InspectionUnitSummary;
  reason: SmsInspectionReason;
  result: SmsInspectionResult;
  condition: SmsVehicleCondition | null;
  odometer: number | null;
  findings: string | null;
  notes: string | null;
  photos: InspectionPhoto[] | null;
  inspector: InspectionInspector | null;
  inspectedAt: Date | null;
  createdAt: Date;
}
