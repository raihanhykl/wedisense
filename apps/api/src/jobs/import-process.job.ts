import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import type { ConnectionOptions } from 'bullmq';
import { runImportJob } from '../modules/reports/service.js';

interface ImportProcessPayload {
  importId: string;
  userId: string;
  filePath: string;
}

const QUEUE_NAME = 'import-process';

export const importProcessWorker = new Worker<ImportProcessPayload>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[import-process] Processing job ${job.id} for import ${job.data.importId}`);
    await runImportJob(job.data);
    console.log(`[import-process] Completed job ${job.id}`);
  },
  { connection: redis as unknown as ConnectionOptions, concurrency: 1 },
);

importProcessWorker.on('failed', (job, err) => {
  console.error(`[import-process] Job ${job?.id} failed:`, err.message);
});

importProcessWorker.on('completed', (job) => {
  console.log(`[import-process] Job ${job.id} completed`);
});
