// PM2 process definitions for the Wedisense VPS.
// Used by scripts/deploy.sh via `pm2 startOrReload ecosystem.config.cjs`.
//
// Ports match the existing nginx vhosts on the VPS:
//   wedisense.wedison.tech      → 127.0.0.1:3100 (web)
//   api-wedisense.wedison.tech  → 127.0.0.1:4100 (api)
// 3000/3001 belong to another project's PM2 apps on the same VPS.
module.exports = {
  apps: [
    {
      name: 'wedisense-api',
      cwd: './apps/api',
      script: 'dist/server.js',
      // The API does not load dotenv itself — Node injects apps/api/.env here.
      // Vars set in `env` below take precedence over the file.
      node_args: '--env-file=.env',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '768M',
      kill_timeout: 10000, // allow graceful shutdown (workers + redis + prisma)
      env: {
        NODE_ENV: 'production',
        PORT: 4100,
      },
    },
    {
      name: 'wedisense-web',
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3100',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '768M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
