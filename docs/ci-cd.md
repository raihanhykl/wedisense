# CI/CD — GitHub Actions → VPS

## Alur branch

```
feature branch ──PR──▶ staging ──PR──▶ main
                         │               │
                         ▼               ▼
              staging-wedisense    wedisense.wedison.tech
                .wedison.tech        (production)
```

1. Setiap perubahan dikerjakan di branch sendiri (`feat/...`, `fix/...`, `chore/...`).
2. PR pertama **selalu ke `staging`**. Merge → otomatis deploy ke staging.
3. Setelah dicek di staging, buka PR `staging` → `main`. Merge → otomatis deploy ke production.
4. Tidak ada yang langsung ke `main`. Hotfix pun lewat `staging` dulu.

## Dua environment di satu VPS

| | Production | Staging |
|---|---|---|
| Branch | `main` | `staging` |
| URL web | https://wedisense.wedison.tech | https://staging-wedisense.wedison.tech |
| URL API | https://api-wedisense.wedison.tech | https://staging-wedisense.wedison.tech/api |
| Direktori di VPS | `/var/www/wedisense` | `/var/www/wedisense-staging` |
| Proses PM2 | `wedisense-api`, `wedisense-web` | `wedisense-api-staging`, `wedisense-web-staging` |
| Port (hanya lewat nginx) | API `4100`, web `3100` | API `4110`, web `3110` |
| Database | `wedisense_prod` | `wedisense_staging` (role DB terpisah) |
| Redis | db `0` | db `1` (`REDIS_URL=redis://localhost:6379/1`) |
| Upload | `/var/www/wedisense/uploads` | `/var/www/wedisense-staging/uploads` |
| `DEPLOY_ENV` | tidak di-set (default `production`) | `staging` |

Staging memakai satu subdomain: nginx meneruskan `/api/` dan `/uploads/` ke API,
sisanya ke web. Karena itu `NEXT_PUBLIC_API_URL` staging sama dengan URL web-nya.

**Kenapa Redis harus db terpisah:** antrean BullMQ memakai nama yang sama di kedua
environment. Kalau staging memakai db `0`, worker staging akan mengambil job
production. `scripts/deploy.sh` menolak deploy staging bila `REDIS_URL` tidak
menunjuk db selain `0`, atau bila `DATABASE_URL` menunjuk `wedisense_prod`.

## How it works

```
PR / push ke main atau staging
      │
      ▼
┌─────────────────────────────┐
│ Job: ci (selalu jalan)      │
│ install → prisma generate → │
│ build shared → typecheck →  │
│ lint → test api → build     │
└─────────────────────────────┘
      │  hanya push + CI hijau
      ├── push ke staging ──▶ Job: deploy-staging
      └── push ke main ─────▶ Job: deploy-production
                                   │
                                   ▼
                    SSH ke VPS → scripts/deploy.sh:
                      git reset --hard origin/<branch>
                      pnpm install
                      prisma migrate deploy
                      pnpm build
                      pm2 startOrReload
                      curl /api/health
```

- Workflow: `.github/workflows/ci-cd.yml`
- Deploy script (jalan di VPS): `scripts/deploy.sh` — satu script untuk dua
  environment, dipilih lewat `DEPLOY_ENV`.
- Definisi proses PM2: `ecosystem.config.cjs` (root repo) — nama proses dan port
  mengikuti `DEPLOY_ENV`.
- 3000/3001 milik project lain di VPS yang sama. Port aplikasi hanya diakses
  lewat reverse proxy nginx — ufw tidak membukanya keluar.
- Kedua job deploy memakai `concurrency: deploy-vps` — build staging dan
  production tidak pernah berjalan bersamaan di VPS (2 CPU, tanpa swap); yang
  kedua antri.

## GitHub Secrets yang wajib di-set

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Isi | Contoh |
|---|---|---|
| `VPS_HOST` | IP / hostname VPS | `103.x.x.x` |
| `VPS_USER` | User SSH untuk deploy | `wedison` |
| `VPS_SSH_KEY` | **Private key** ed25519 khusus deploy (lihat bawah) | isi file `github_deploy` |
| `VPS_PORT` | (Opsional) port SSH, default 22 | `22` |
| `VPS_APP_DIR` | Path repo **production** di VPS | `/var/www/wedisense` |

Staging tidak butuh secret tambahan: direktorinya diturunkan dari
`VPS_APP_DIR` + `-staging`.

### Membuat SSH key khusus deploy

Jalankan di mesin lokal (jangan pakai key pribadi kamu):

```bash
ssh-keygen -t ed25519 -C "github-actions-wedisense" -f github_deploy -N ""
# Public key → VPS
ssh-copy-id -i github_deploy.pub <user>@<vps-host>
# Private key → isi secret VPS_SSH_KEY (seluruh isi file, termasuk header BEGIN/END)
cat github_deploy
```

## Setup satu kali di VPS

1. **Prasyarat**: Node.js ≥ 20.6 (dipakai `node --env-file`), pnpm ≥ 9, pm2, git.
   ```bash
   node -v && pnpm -v && pm2 -v
   ```
2. **Clone repo** ke direktori environment-nya:
   ```bash
   git clone https://github.com/raihanhykl/wedisense /var/www/wedisense                       # production
   git clone -b staging https://github.com/raihanhykl/wedisense /var/www/wedisense-staging    # staging
   ```
3. **File env** (tidak pernah dikirim lewat CI, dibuat langsung di VPS):
   - `apps/api/.env` — `DATABASE_URL`, `REDIS_URL`, JWT secrets, `CORS_ORIGIN`,
     `STORAGE_PATH`, `APP_BASE_URL`, dll. Staging **wajib** memakai database,
     Redis db, JWT secret, dan `STORAGE_PATH` sendiri.
   - `apps/web/.env.local` — `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`
     (URL publik asli; dibaca saat build).
4. **Database staging** (sekali saja, sebagai user `postgres`):
   ```sql
   CREATE ROLE wedisense_staging LOGIN PASSWORD '<acak>';
   CREATE DATABASE wedisense_staging OWNER wedisense_staging;
   ```
   Role ini tidak punya akses ke `wedisense_prod`.
5. **nginx + SSL**: vhost `wedisense` (production) dan `wedisense-staging`
   di `/etc/nginx/sites-available/`, sertifikat lewat `certbot --nginx`.
6. **Seed data sistem** setelah deploy pertama (role, permission, lokasi, akun
   super admin dari `BOOTSTRAP_ADMIN_*`):
   ```bash
   cd /var/www/wedisense-staging/apps/api
   pnpm exec tsx --env-file=.env prisma/seed.ts
   ```
7. **Proses PM2**: deploy pertama menjalankan `pm2 startOrReload` lalu `pm2 save`.
   PERINGATAN: jangan `pm2 delete all` — VPS dipakai project lain.
   `startOrReload` hanya menyentuh dua proses milik environment yang sedang
   di-deploy.

## Operasional

- **Deploy manual** (tanpa menunggu push), sebagai user deploy di VPS:
  ```bash
  cd /var/www/wedisense && bash scripts/deploy.sh                              # production
  cd /var/www/wedisense-staging && DEPLOY_ENV=staging bash scripts/deploy.sh   # staging
  ```
- **Rollback**: di VPS — `git reset --hard <sha-sebelumnya>` lalu jalankan ulang
  langkah build di `scripts/deploy.sh` mulai dari `pnpm install`. Catatan:
  `prisma migrate deploy` tidak bisa di-rollback otomatis; migration mundur
  harus ditangani manual. Karena itu setiap migrasi dicoba di staging dulu.
- **Log**: `pm2 logs wedisense-api` / `pm2 logs wedisense-web`
  (staging: tambahkan `-staging`).
- **Status workflow**: tab *Actions* di GitHub; deploy gagal health check akan
  menandai run merah dan mencetak 30 baris log API terakhir.
- **Data staging** terpisah dari production dan boleh dirusak untuk uji coba.
  Email notifikasi staging dimatikan (`NOTIFICATION_EMAIL_ENABLED=false`).
