import { Queue, type ConnectionOptions } from 'bullmq';
import { redis } from './redis.js';

// ── Connection shared across all queues ──────────────────────────────
const connection = redis as unknown as ConnectionOptions;

// ── Job timezone ─────────────────────────────────────────────────────
export const JOB_TIMEZONE = process.env['JOB_TIMEZONE'] ?? 'Asia/Jakarta';

// ── Default job options ───────────────────────────────────────────────
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

// ── Queue instances ───────────────────────────────────────────────────
export const warrantyCheckQueue = new Queue<Record<string, never>>('warranty-check', {
  connection,
  defaultJobOptions,
});

export const loanOverdueQueue = new Queue<Record<string, never>>('loan-overdue', {
  connection,
  defaultJobOptions,
});

export const maintenanceDueQueue = new Queue<Record<string, never>>('maintenance-due', {
  connection,
  defaultJobOptions,
});

export const depreciationQueue = new Queue<Record<string, never>>('depreciation', {
  connection,
  defaultJobOptions: { ...defaultJobOptions, attempts: 2 },
});

export const weeklySummaryQueue = new Queue<Record<string, never>>('weekly-summary', {
  connection,
  defaultJobOptions,
});

export const tourSyncQueue = new Queue<{ roleId: string }>('tour-sync', {
  connection,
  defaultJobOptions,
});

export const reportGenerateQueue = new Queue<{ reportId: string; format: 'excel' | 'pdf' }>('report-generate', {
  connection,
  defaultJobOptions,
});

export const printGenerateQueue = new Queue<{ printJobId: string }>('print-generate', {
  connection,
  defaultJobOptions,
});

export const importProcessQueue = new Queue<{ importId: string; userId: string; filePath: string }>('import-process', {
  connection,
  defaultJobOptions,
});

// ── Bootstrap recurring schedulers ───────────────────────────────────
//
// BullMQ v5 introduced Job Schedulers as the canonical mechanism for
// recurring jobs. `queue.upsertJobScheduler(id, repeatOpts, jobTemplate)`
// is idempotent under id, so re-running on every server boot will not
// accumulate duplicate schedules.

export async function bootstrapSchedulers(): Promise<void> {
  // Daily 07:00 WIB
  await warrantyCheckQueue.upsertJobScheduler(
    'warranty-check-daily',
    { pattern: '0 7 * * *', tz: JOB_TIMEZONE },
    { name: 'run', data: {} },
  );

  // Daily 08:00 WIB
  await loanOverdueQueue.upsertJobScheduler(
    'loan-overdue-daily',
    { pattern: '0 8 * * *', tz: JOB_TIMEZONE },
    { name: 'run', data: {} },
  );

  // Daily 08:00 WIB
  await maintenanceDueQueue.upsertJobScheduler(
    'maintenance-due-daily',
    { pattern: '0 8 * * *', tz: JOB_TIMEZONE },
    { name: 'run', data: {} },
  );

  // Monthly 02:00 WIB on day 1
  await depreciationQueue.upsertJobScheduler(
    'depreciation-monthly',
    { pattern: '0 2 1 * *', tz: JOB_TIMEZONE },
    { name: 'run', data: {} },
  );

  // Monday 08:00 WIB
  await weeklySummaryQueue.upsertJobScheduler(
    'weekly-summary-mondays',
    { pattern: '0 8 * * 1', tz: JOB_TIMEZONE },
    { name: 'run', data: {} },
  );

  console.log(
    '[Schedulers] warranty-check, loan-overdue, maintenance-due, depreciation, weekly-summary registered',
  );
}
