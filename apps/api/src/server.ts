import { app } from './app.js';
import { bootstrapSchedulers } from './lib/queue.js';
import { startWorkers, stopWorkers } from './jobs/worker.js';
import { redis } from './lib/redis.js';
import { prisma } from './lib/prisma.js';

const PORT = Number(process.env['PORT']) || 4000;

const server = app.listen(PORT, () => {
  console.log(`[API] Server running on http://localhost:${PORT}`);
  console.log(`[API] Health check: http://localhost:${PORT}/api/health`);

  // Start BullMQ workers (they self-register on module load)
  startWorkers();

  // Register recurring schedulers
  bootstrapSchedulers().catch((err: unknown) => {
    console.error(
      '[Schedulers] Failed to bootstrap:',
      err instanceof Error ? err.message : err,
    );
  });
});

// ── Graceful shutdown ─────────────────────────────────────────────────
//
// On SIGTERM/SIGINT, stop accepting new HTTP connections, drain workers,
// then close the shared Redis client and Prisma pool so the process can
// exit cleanly without dangling connections or reconnect backoff loops.

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[API] ${signal} received — shutting down`);

  server.close();

  try {
    await stopWorkers();
  } catch (err) {
    console.error('[Workers] Stop error:', err instanceof Error ? err.message : err);
  }

  try {
    await Promise.all([redis.quit(), prisma.$disconnect()]);
  } catch (err) {
    console.error('[Shutdown] Connection close error:', err instanceof Error ? err.message : err);
  }

  console.log('[API] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
