# CI/CD — GitHub Actions → VPS

## How it works

```
PR / push ke main
      │
      ▼
┌─────────────────────────────┐
│ Job: ci (selalu jalan)      │
│ install → prisma generate → │
│ build shared → typecheck →  │
│ lint → test api → build     │
└─────────────────────────────┘
      │  hanya push ke main + CI hijau
      ▼
┌─────────────────────────────┐
│ Job: deploy                 │
│ SSH ke VPS →                │
│ scripts/deploy.sh:          │
│   git reset --hard          │
│   pnpm install              │
│   prisma migrate deploy     │
│   pnpm build                │
│   pm2 startOrReload         │
│   curl /api/health          │
└─────────────────────────────┘
```

- Workflow: `.github/workflows/ci-cd.yml`
- Deploy script (jalan di VPS): `scripts/deploy.sh`
- Definisi proses PM2: `ecosystem.config.cjs` (root repo)
- Port di VPS mengikuti vhost nginx yang sudah ada: API `4100`
  (api-wedisense.wedison.tech), web `3100` (wedisense.wedison.tech).
  3000/3001 milik project lain di VPS yang sama. Port-port ini hanya diakses
  lewat reverse proxy nginx — ufw tidak membukanya keluar.
- Deploy memakai `concurrency: deploy-production` — dua merge beruntun tidak akan
  deploy bersamaan; yang kedua antri.

## GitHub Secrets yang wajib di-set

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Isi | Contoh |
|---|---|---|
| `VPS_HOST` | IP / hostname VPS | `103.x.x.x` |
| `VPS_USER` | User SSH untuk deploy | `wedison` |
| `VPS_SSH_KEY` | **Private key** ed25519 khusus deploy (lihat bawah) | isi file `github_deploy` |
| `VPS_PORT` | (Opsional) port SSH, default 22 | `22` |
| `VPS_APP_DIR` | Path repo di VPS | `/home/wedison/wedisense` |

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
2. **Clone repo** (kalau belum berbentuk git clone):
   ```bash
   git clone git@github.com:raihanhykl/wedisense.git ~/wedisense
   ```
   Repo privat → tambahkan SSH key **milik VPS** sebagai *Deploy key* (read-only)
   di GitHub: repo → Settings → Deploy keys. Ini key yang berbeda dari key
   GitHub Actions di atas (arah aksesnya kebalikan: VPS → GitHub).
3. **File env** (tidak pernah dikirim lewat CI):
   - `apps/api/.env` — DATABASE_URL, REDIS, JWT secrets, dll.
   - `apps/web/.env.local` — `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL` (URL publik asli)
4. **Migrasi dari proses PM2 lama** ke ecosystem file (sekali saja).
   PERINGATAN: jangan `pm2 delete all` kalau VPS dipakai project lain —
   hapus hanya proses wedisense lama, by name/id:
   ```bash
   pm2 ls                  # catat nama/id proses wedisense LAMA
   pm2 delete <nama-lama>  # hanya proses wedisense, satu per satu
   cd ~/wedisense
   bash scripts/deploy.sh  # build + start wedisense-api & wedisense-web
   pm2 save                # snapshot seluruh daftar proses (project lain ikut tersimpan)
   pm2 startup             # lewati kalau sudah pernah di-setup di VPS ini
   ```
   `pm2 startOrReload ecosystem.config.cjs` di deploy.sh hanya menyentuh
   `wedisense-api` dan `wedisense-web` — proses project lain tidak terpengaruh.

## Operasional

- **Deploy manual** (tanpa menunggu push): SSH ke VPS lalu `bash scripts/deploy.sh`.
- **Rollback**: di VPS — `git reset --hard <sha-sebelumnya>` lalu jalankan ulang
  langkah build di `scripts/deploy.sh` mulai dari `pnpm install`. Catatan:
  `prisma migrate deploy` tidak bisa di-rollback otomatis; migration mundur
  harus ditangani manual.
- **Log**: `pm2 logs wedisense-api` / `pm2 logs wedisense-web`.
- **Status workflow**: tab *Actions* di GitHub; deploy gagal health check akan
  menandai run merah dan mencetak 30 baris log API terakhir.
