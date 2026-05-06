import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import type { ConnectionOptions } from 'bullmq';

const QUEUE_NAME = 'print-generate';

export const printGenerateWorker = new Worker<{ printJobId: string }, { scaffolded: boolean }>(
  QUEUE_NAME,
  (job) => {
    console.log(`[print-generate] received job ${job.id}, scaffolded for Phase 12`);
    return Promise.resolve({ scaffolded: true });
  },
  { connection: redis as unknown as ConnectionOptions, concurrency: 2 },
);

printGenerateWorker.on('failed', (job, err) => {
  console.error(`[print-generate] Job ${job?.id} failed:`, err.message);
});
