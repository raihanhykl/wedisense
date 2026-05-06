import { warrantyCheckWorker } from './warranty-check.job.js';
import { loanOverdueWorker } from './loan-overdue.job.js';
import { maintenanceDueWorker } from './maintenance-due.job.js';
import { depreciationWorker } from './depreciation.job.js';
import { weeklySummaryWorker } from './weekly-summary.job.js';
import { tourSyncWorker } from './tour-sync.job.js';
import { reportGenerateWorker } from './report-generate.job.js';
import { printGenerateWorker } from './print-generate.job.js';
import { importProcessWorker } from './import-process.job.js';
import type { Worker } from 'bullmq';

// All workers are instantiated on module load
const workers: Worker[] = [
  warrantyCheckWorker,
  loanOverdueWorker,
  maintenanceDueWorker,
  depreciationWorker,
  weeklySummaryWorker,
  tourSyncWorker,
  reportGenerateWorker,
  printGenerateWorker,
  importProcessWorker,
];

export function startWorkers(): Worker[] {
  console.log(`[Workers] Started ${workers.length} workers`);
  return workers;
}

export async function stopWorkers(): Promise<void> {
  console.log('[Workers] Closing...');
  await Promise.all(workers.map((w) => w.close()));
}
