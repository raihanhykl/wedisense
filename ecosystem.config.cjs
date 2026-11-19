// PM2 process definitions for the Wedisense VPS.
// Used by scripts/deploy.sh via `pm2 startOrReload ecosystem.config.cjs`.
//
// One VPS hosts both environments; DEPLOY_ENV selects which pair of processes
// this file describes. It defaults to production, so a plain
// `pm2 startOrReload ecosystem.config.cjs` behaves exactly as it always has.
//
//   production (DEPLOY_ENV unset)   /var/www/wedisense
//     wedisense.wedison.tech          → 127.0.0.1:3100 (web)
//     api-wedisense.wedison.tech      → 127.0.0.1:4100 (api)
//   staging (DEPLOY_ENV=staging)    /var/www/wedisense-staging
//     staging-wedisense.wedison.tech  → 127.0.0.1:3110 (web)
//     staging-wedisense.wedison.tech/api, /uploads → 127.0.0.1:4110 (api)
//
// 3000/3001 belong to another project's PM2 apps on the same VPS.
const TARGETS = {
  production: { suffix: '', apiPort: 4100, webPort: 3100, maxMemory: '768M' },
  staging: { suffix: '-staging', apiPort: 4110, webPort: 3110, maxMemory: '512M' },
};

const deployEnv = process.env.DEPLOY_ENV || 'production';
const target = TARGETS[deployEnv];

if (!target) {
  throw new Error(
    `Unknown DEPLOY_ENV "${deployEnv}". Expected one of: ${Object.keys(TARGETS).join(', ')}`,
  );
}

module.exports = {
  apps: [
    {
      name: `wedisense-api${target.suffix}`,
      cwd: './apps/api',
      script: 'dist/server.js',
      // The API does not load dotenv itself — Node injects apps/api/.env here.
      // Vars set in `env` below take precedence over the file.
      node_args: '--env-file=.env',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: target.maxMemory,
      kill_timeout: 10000, // allow graceful shutdown (workers + redis + prisma)
      env: {
        NODE_ENV: 'production',
        PORT: target.apiPort,
      },
    },
    {
      name: `wedisense-web${target.suffix}`,
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: `start --port ${target.webPort}`,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: target.maxMemory,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
