import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import type { ConnectionOptions } from 'bullmq';

const QUEUE_NAME = 'import-process';

export const importProcessWorker = new Worker<{ importId: string }, { scaffolded: boolean }>(
  QUEUE_NAME,
  (job) => {
    console.log(`[import-process] received job ${job.id}, scaffolded for Phase 12`);
    return Promise.resolve({ scaffolded: true });
  },
  { connection: redis as unknown as ConnectionOptions, concurrency: 1 },
);

importProcessWorker.on('failed', (job, err) => {
  console.error(`[import-process] Job ${job?.id} failed:`, err.message);
});
