// PM2 process definitions for the Wedisense VPS.
// Used by scripts/deploy.sh via `pm2 startOrReload ecosystem.config.cjs`.
module.exports = {
  apps: [
    {
      name: 'wedisense-api',
      cwd: './apps/api',
      script: 'dist/server.js',
      // The API does not load dotenv itself — Node injects apps/api/.env here.
      node_args: '--env-file=.env',
      instances: 1,
      autorestart: true,
      max_memory_restart: '768M',
      kill_timeout: 10000, // allow graceful shutdown (workers + redis + prisma)
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'wedisense-web',
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      // 3000 is taken by another project's PM2 app on this VPS
      args: 'start --port 3001',
      instances: 1,
      autorestart: true,
      max_memory_restart: '768M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
