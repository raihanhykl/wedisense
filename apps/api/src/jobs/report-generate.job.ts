import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import type { ConnectionOptions } from 'bullmq';

const QUEUE_NAME = 'report-generate';

export const reportGenerateWorker = new Worker<{ reportId: string }, { scaffolded: boolean }>(
  QUEUE_NAME,
  (job) => {
    console.log(`[report-generate] received job ${job.id}, scaffolded for Phase 12`);
    return Promise.resolve({ scaffolded: true });
  },
  { connection: redis as unknown as ConnectionOptions, concurrency: 2 },
);

reportGenerateWorker.on('failed', (job, err) => {
  console.error(`[report-generate] Job ${job?.id} failed:`, err.message);
});
