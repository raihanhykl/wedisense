import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import type { ConnectionOptions } from 'bullmq';
import { runReportJob } from '../modules/reports/service.js';

interface ReportGeneratePayload {
  reportId: string;
  format: 'excel' | 'pdf';
}

const QUEUE_NAME = 'report-generate';

export const reportGenerateWorker = new Worker<ReportGeneratePayload>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[report-generate] Processing job ${job.id} for report ${job.data.reportId}`);
    await runReportJob(job.data);
    console.log(`[report-generate] Completed job ${job.id}`);
  },
  { connection: redis as unknown as ConnectionOptions, concurrency: 2 },
);

reportGenerateWorker.on('failed', (job, err) => {
  console.error(`[report-generate] Job ${job?.id} failed:`, err.message);
});

reportGenerateWorker.on('completed', (job) => {
  console.log(`[report-generate] Job ${job.id} completed`);
});
