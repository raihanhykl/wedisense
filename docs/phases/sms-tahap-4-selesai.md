# SMS Tahap 4 — RTO dan Retur (selesai)

**Tanggal:** 20 November 2026 · **Branch:** `feat/sms-4-rto-returns` · **PR:** → `staging`
Acuan: [stock-management-system.md](../specs/stock-management-system.md) · [sms-technical-design.md](../specs/sms-technical-design.md) · laporan sebelumnya: [sms-tahap-3-selesai.md](sms-tahap-3-selesai.md)

Menu baru di bagian **Stock**: **Returns**. Kartu VIN, halaman SPK, dashboard, dan halaman Notifications ikut diperluas.

**Satu migrasi kecil yang hanya menambah** (`add_sms_return_notification_types`): dua jenis notifikasi baru, `SMS_RETURN_REQUESTED` dan `SMS_RETURN_DECIDED`. Tidak ada tabel atau data yang diubah; tabel RTO dan retur sudah ada sejak Tahap 2. Teks notifikasi SMS ditulis langsung dalam bahasa Inggris (konsisten dengan layar SMS), sehingga file terjemahan `packages/shared/locales` tidak disentuh. Tidak ada dependency baru.

---

## 1. Fitur yang selesai

### 1.1 Serah terima RTO — kartu VIN atau halaman SPK → **Hand over as RTO**
- **Apa:** motor keluar dengan kontrak *rent to own*. Bisa dari unit siap (kartu VIN) atau dari unit yang sudah di-booking (baris SPK). Kalau dari booking, data customer dan sales terisi otomatis dari SPK.
- **Fungsi:**
  - Nomor kontrak diketik dari dokumen asli dan dirapikan otomatis: spasi dibuang, huruf jadi kapital, contoh `rto-jkt-0099` → `RTO-JKT-0099`.
  - Nomor kontrak unik di seluruh jaringan.
  - Satu VIN maksimal punya **satu kontrak aktif**.
  - Motor keluar dari stok fisik dan mendapat label permanen **Ex-RTO**.
- **Cara pakai:** isi nomor kontrak, customer, sales (dari data pegawai), tanggal mulai kontrak, dan jam serah terima WIB (default sekarang).

### 1.2 Riwayat kontrak per VIN — kartu VIN → *Contract periods*
- **Apa:** setiap kontrak tampil sebagai satu periode, terbaru di atas.
- **Isi periode:** showroom asal, customer, sales, tanggal mulai, jam serah terima, retur atau penarikan, showroom yang menerima, tanggal tutup, referensi legal, dan hasil akhir (*Returned*, *Repossessed*, atau *Ownership transferred*).
- **Status:** *Active* (motor di customer), *Returned · awaiting closure* (motor sudah kembali, kontrak belum ditutup), atau ditutup.
- **Lainnya:** No. KTP hanya terlihat oleh pemegang izin `sms-customers:view`. Pencarian unit juga bisa memakai nomor kontrak.

### 1.3 Retur RTO di cabang asal — kartu VIN → **Record RTO return**
- **Apa:** motor dikembalikan customer atau ditarik, dan diterima di showroom penanggung jawabnya.
- **Fungsi:** motor kembali masuk stok fisik dengan status *Inspection*. Inspeksi *"RTO return"* otomatis muncul di antrean Inspections, berisi kondisi dan odometer. Kontrak **tetap terbuka**.

### 1.4 Tutup kontrak dan pelepasan — **Close contract**, lalu **Release unit**
- **Apa:** mencatat penutupan kontrak setelah ada konfirmasi dari legal di luar SMS. Isi tanggal tutup, referensi legal (opsional), dan catatan.
- **Fungsi:** unit baru bisa dilepas jadi *Ready* setelah **kontrak ditutup dan inspeksi lulus**. Urutannya bebas: inspeksi boleh lulus lebih dulu. Selama ada yang belum terpenuhi, kartu VIN menuliskan alasannya, misalnya *"RTO contract not closed yet"*.
- Tombol *Close contract* hanya muncul kalau motor sudah benar-benar kembali. Motor yang masih di customer tidak bisa "ditutup kontraknya"; untuk itu dipakai alih milik.

### 1.5 Alih milik — kartu VIN → **Transfer ownership**
- **Apa:** RTO selesai dan motor menjadi milik customer.
- **Fungsi:** kontrak ditutup dengan hasil *Ownership transferred* (tanggal dan referensi legal). Motor tetap di customer, tidak dihitung stok.

### 1.6 Retur lintas cabang dan titipan — menu **Returns**
Contoh: rider kontrak Jakarta mengembalikan motornya ke **Showroom Bandung**.

| Langkah | Siapa | Yang terjadi |
|---|---|---|
| **New request** | Admin Bandung (penerima) | Cari unit lewat VIN, akhiran VIN, atau nomor kontrak. Hasilnya terbatas: model, status, showroom penanggung jawab, nomor kontrak. Nama customer disamarkan "[Hidden]" tanpa izin `sms-customers:view`. Isi alasan. Nomor permintaan dibuat otomatis, misalnya `RET-20261120-0001` |
| Motor sudah dibawa rider (*titipan*) | Admin Bandung | Centang *"The motorcycle is already physically here"* saat membuat permintaan, atau *Record arrival* belakangan. Motor masuk stok fisik Bandung berstatus *In custody* (tidak siap dijual); penanggung jawabnya **masih Jakarta** |
| **Decide** (setujui/tolak) | Admin Jakarta (asal), atau pengguna global seperti Central Ops / Super Admin | Notifikasi masuk ke lonceng admin Jakarta saat permintaan dibuat. Hanya satu keputusan yang berlaku; pemutus kedua mendapat pesan "This return request has already been decided". Pengaju mendapat notifikasi hasilnya |
| **Official receipt** | Admin Bandung, setelah disetujui | Motor masuk *Inspection* di Bandung dan **Bandung menjadi penanggung jawab**. Stok fisik Bandung bertambah tepat satu kali, termasuk kalau sebelumnya sudah dititipkan. Kontrak Jakarta tercatat "diterima di Bandung" dan ditutup oleh admin Bandung |
| Ditolak padahal motor sudah dititipkan | Admin Bandung | Tetap *In custody* dan muncul di *Needs follow-up* **kedua showroom**. Selesaikan dengan **Hand back to rider** (motor kembali ke rider, kontrak tetap aktif) atau ajukan permintaan baru (titipan ikut pindah) |
| Ditolak sebelum motor datang | — | Unit tidak berubah, permintaan selesai |

Tab di halaman Returns: **To decide** (permintaan yang harus saya putuskan), **Our requests** (permintaan saya), **Custody held** (motor yang dititipkan di showroom saya), **Closed**. Kartu VIN menampilkan blok *Open return request*.

### 1.7 Retur penjualan — halaman SPK atau kartu VIN → **Record sale return**
- **Apa:** motor yang sudah terjual (belum atau sudah diambil) dikembalikan customer.
- **Fungsi:**
  1. Catat jam WIB diterima, alasan, dan kondisi (wajib). Motor masuk *Inspection*.
  2. **Decide sale return:**
     - Disetujui → baris SPK *Returned*; unit bisa dilepas setelah inspeksi lulus.
     - Ditolak (alasan wajib) → motor diserahkan kembali ke customer.

### 1.8 Kontrak dari saldo awal
Kontrak RTO aktif yang dimasukkan lewat *Opening Balance* bisa diproses dengan semua alur di atas: retur di cabang asal, retur lintas cabang, tutup kontrak, dan alih milik.

### 1.9 *Needs follow-up* dan notifikasi
- Dashboard menambah lima antrean:
  - **Returns to decide**
  - **Awaiting official receipt**
  - **Custody held** (yang ditolak diberi tanda merah)
  - **RTO returned — contract not closed**
  - **Sale returns to decide**
- Halaman Notifications mengenali dua jenis baru (*RETURN REQUESTED*, *RETURN DECIDED*). Mengklik notifikasi membuka halaman terkait.

---

## 2. Cara testing manual (di staging)

**Persiapan (sekali saja)**
1. Merge PR Tahap 4 ke `staging` dan tunggu deploy selesai. Migrasi notifikasi berjalan otomatis; tidak perlu seed ulang.
2. Siapkan tiga akun:
   - **Admin Jakarta**: `SMS_SHOWROOM_ADMIN` di Showroom Jakarta (dari Tahap 2).
   - **Admin Bandung**: `SMS_SHOWROOM_ADMIN` di Showroom Bandung (Users → edit → peran + lokasi).
   - **Global**: Super Admin.
3. Pastikan Showroom Jakarta punya minimal **4 unit Ready** (lewat Opening Balance bila perlu).
4. Pakai dua browser (biasa + Incognito) supaya dua admin bisa login bersamaan.

| # | Akun | Langkah | Hasil yang harus terlihat |
|---|---|---|---|
| 1 | Jakarta | Kartu VIN unit A → *Hand over as RTO* → nomor `rto-a-001`, customer, sales, tanggal mulai | Toast "RTO contract RTO-A-001 created". Status *Active RTO* + label *Ex-RTO*; *Contract periods* berisi RTO-A-001 *Active*. Dashboard: Physical turun 1 |
| 2 | Jakarta | Ulangi langkah 1 di unit B dengan nomor `RTO-A-001` | Ditolak: nomor kontrak sudah dipakai |
| 3 | Jakarta | Unit A: perhatikan tombolnya | Ada *Record RTO return* dan *Transfer ownership*; **tidak ada** *Close contract* (motor masih di customer) |
| 4 | Jakarta | *Record RTO return* → Returned by customer, kondisi Fair, odometer | Status *Inspection*, Physical naik 1. Kontrak: *Returned · awaiting closure*. Menu Inspections berisi "RTO return" |
| 5 | Jakarta | *Record inspection result* → Passed | *Release* belum bisa; tertulis "RTO contract not closed yet" |
| 6 | Jakarta | *Close contract* → referensi legal "LEGAL-01" → lalu *Release unit* | Kontrak tertutup (*Returned*, tanggal, referensi). Unit *Ready* dan tetap berlabel *Ex-RTO* |
| 7 | Jakarta | Unit A lagi → *Hand over as RTO* nomor `RTO-B-002` | Berhasil; *Contract periods* sekarang berisi 2 periode |
| 8 | Jakarta | Unit C → *Hand over as RTO* nomor `RTO-C-003` | Kontrak aktif, untuk uji lintas cabang |
| 9 | Bandung | *Returns* → *New request* → cari `RTO-C-003` | Hasil: unit C, penanggung jawab Showroom Jakarta, customer "[Hidden]" |
| 10 | Bandung | Pilih unit → alasan → centang *already physically here* → *Create request* | Nomor `RET-…`. Dashboard Bandung: Physical +1, Ready tidak bertambah, *In custody* 1. Kartu VIN: penanggung jawab **masih Jakarta** |
| 11 | Jakarta | Lonceng notifikasi | Ada "Return request RET-…". *Returns* → *To decide* berisi permintaan itu |
| 12 | Jakarta + Global | Buka *Decide* di dua browser (Jakarta dan Super Admin), setujui di keduanya hampir bersamaan | Satu berhasil; yang lain mendapat pesan "already decided" |
| 13 | Bandung | *Our requests* → *Official receipt* → kondisi → konfirmasi | Unit *Inspection* di Bandung, **penanggung jawab Bandung**, Physical Bandung **tidak** bertambah lagi. Kontrak: diterima di Showroom Bandung, masih terbuka |
| 14 | Bandung | Kartu VIN unit C → *Close contract* → inspeksi Passed → *Release unit* | Unit *Ready* di Bandung, label *Ex-RTO* |
| 15 | Jakarta | Unit D → *Hand over as RTO*; Bandung ajukan retur **dengan titipan**; Jakarta **tolak** dengan alasan | Bandung: unit tetap *In custody*, muncul di *Custody held* bertanda ditolak, dan di *Needs follow-up* kedua showroom |
| 16 | Bandung | *Hand back to rider* | Unit kembali *Active RTO*, keluar dari stok fisik Bandung; kontrak tetap aktif |
| 17 | Jakarta | Unit D → *Transfer ownership* | Status *Picked up*; kontrak tertutup "Ownership transferred" |
| 18 | Jakarta | SPK yang unitnya sudah diambil (dari Tahap 3) → *Record return* → alasan + kondisi | Unit *Inspection*; baris "Return received — awaiting decision". *Needs follow-up*: *Sale returns to decide* |
| 19 | Jakarta | *Decide* → Reject + alasan | Motor kembali ke customer (*Picked up*), keluar dari stok fisik |
| 20 | Bandung | Buka URL kartu VIN unit Jakarta yang tidak terkait Bandung | "not found"; tombol aksi Jakarta tidak bisa dipakai |

---

## 3. Rencana Tahap 5 — Pilot

Fitur yang akan terbuka:

| Fitur | Untuk apa | Cara kerjanya nanti |
|---|---|---|
| **Rekap stok dan ekspor mutasi** | Laporan ke atasan dan rekonsiliasi | Saldo per showroom dan semua mutasi pada rentang tanggal (asal, tujuan, alasan, referensi), dihitung dari riwayat yang sama dengan dashboard. Ekspor ke Excel |
| **Koreksi transaksi** | Salah input tanggal, lokasi, atau referensi | Koreksi atau batalkan kejadian terakhir dengan alasan wajib. Sistem menolak dan menampilkan dampaknya bila koreksi merusak riwayat. Transaksi asal dan koreksinya sama-sama terlihat di kartu VIN, audit, dan rekap (A15) |
| **Pengerasan akses dan integritas** | Keamanan sebelum dipakai nyata | Uji akses per showroom di setiap jalur (A13), penyamaran data customer, script pengecek "riwayat = status sekarang", dan **pengunci database** supaya riwayat VIN tidak bisa diubah/dihapus |
| **Uji penerimaan penuh** | Kesiapan pilot | Skenario A01–A15 dijalankan lewat layar dengan bukti screenshot 360/768/1440, plus checklist pilot untuk satu showroom aktif RTO dan cabang pasangannya |

**Perlu persetujuan Anda di Tahap 5:** pengunci riwayat VIN berupa *trigger* database yang ditulis manual (bukan hasil generator), supaya baris riwayat `sms_unit_events` tidak bisa di-UPDATE/DELETE oleh siapa pun. Hanya menambah, tidak mengubah data; SQL-nya akan saya tunjukkan dulu sebelum diterapkan.

---

## Lampiran — bukti verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `pnpm --filter api typecheck` / `pnpm --filter web typecheck` | Bersih |
| `pnpm lint` | 0 error (21 warning lama `no-console` di API, tidak berubah) |
| `pnpm --filter api test` | 812/812 lulus |
| `pnpm --filter api test:integration` (PostgreSQL asli) | 83/83 lulus, termasuk kasus desain (c) + A06, A07–A10, A11, A14 bagian kedua, keputusan bersamaan, titipan ditolak lalu diserahkan kembali/diajukan ulang, alih milik, penyamaran data, notifikasi |
| `pnpm --filter web tour:check` | Lulus |
| `pnpm --filter web build` | Berhasil |
| Browser (Playwright, data lokal) | Serah terima RTO → retur lintas cabang dengan titipan → notifikasi → persetujuan → penerimaan resmi → pemblokir pelepasan. Tidak ada overflow horizontal di 360 / 768 / 1440 px pada dashboard, Returns, kartu VIN, Orders, dan Notifications |

**Temuan yang diperbaiki saat verifikasi:**
- Respons yang membaca data di luar transaksi.
- Serah terima RTO kedua pada unit aktif menjawab 403, sekarang 409 dengan pesan yang benar.
- Tombol *Close contract* muncul saat motor masih di customer.
- Form retur penjualan di halaman SPK membolehkan kondisi kosong, padahal server mewajibkannya; dialog ganda kini disatukan.
- Label kontrak yang sudah kembali masih "Active".
- Tampilan tabel Returns terpotong di layar lebar.
