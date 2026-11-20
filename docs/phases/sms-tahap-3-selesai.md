# SMS Tahap 3 — Booking dan Barang Keluar (selesai)

**Tanggal:** 20 November 2026 · **Branch:** `feat/sms-3-booking-sales` · **PR:** → `staging`
Acuan: [stock-management-system.md](../specs/stock-management-system.md) · [sms-technical-design.md](../specs/sms-technical-design.md) · laporan sebelumnya: [sms-tahap-2-selesai.md](sms-tahap-2-selesai.md)

Dua menu baru di bagian **Stock** pada sidebar: **Orders (SPK)** dan **Show units**. Kartu VIN dan dashboard *My Showroom Stock* ikut diperluas. Tahap ini **tanpa migrasi database** (tabelnya sudah dibuat di Tahap 2) dan **tanpa dependency baru**.

---

## 1. Fitur yang selesai

### 1.1 SPK multiunit — *Orders (SPK) → New SPK*
- **Apa:** satu SPK bisa memesan beberapa motor. Data customer dan sales cukup diisi sekali.
- **Fungsi:** begitu disimpan, setiap VIN di SPK terkunci untuk customer itu dan keluar dari angka *Ready*. Header SPK dan semua unitnya disimpan **sekaligus**: kalau satu VIN gagal, tidak ada yang tersimpan, jadi tidak ada SPK setengah jadi.
- **Cara pakai:**
  1. Isi nomor SPK seperti di kertas. Nomor dirapikan otomatis: spasi di awal/akhir dibuang, huruf jadi kapital, `spk-021` → `SPK-021`.
  2. Pilih **sales** dari data pegawai. Pegawai yang belum punya login juga muncul.
  3. Isi nama customer. Telepon dan No. KTP opsional; No. KTP hanya terlihat oleh pemegang izin `sms-customers:view`.
  4. Di *Units to book*, ketik minimal 4 karakter akhir VIN, lalu pilih unit. Hanya unit **siap** di showroom ini yang muncul. *+ Add another unit* untuk motor berikutnya.
  5. *Create SPK*.
- Dari kartu VIN unit siap, tombol **Book** membuka form ini dengan VIN tersebut sudah terisi.
- Halaman SPK menampilkan **sales pemilik booking** terpisah dari **admin pencatat**.
- Nomor SPK unik per showroom. Kalau nomornya sudah ada, admin diarahkan ke SPK tersebut untuk *Add units*.

### 1.2 Konflik booking
- **Apa:** dua admin yang mem-booking VIN yang sama bersamaan: tepat satu yang berhasil.
- **Fungsi:** admin kedua melihat banner merah **di baris VIN itu** (bukan pop-up yang hilang), misalnya *"Already booked by Dina for SPK-021"*, beserta maksimal 5 unit alternatif (varian sama, warna sama didahulukan).
- **Cara pakai:** klik salah satu alternatif untuk mengganti VIN di baris itu, lalu *Create SPK* lagi.

### 1.3 Batal booking per VIN — tombol **Cancel** di baris SPK
- **Apa:** membatalkan satu VIN tanpa menyentuh VIN lain di SPK yang sama.
- **Fungsi:** alasan wajib diisi dan tersimpan di riwayat VIN. Hanya VIN itu yang kembali *Ready*.
- **Batasan:** hanya untuk unit yang masih *Booked*. Unit yang sudah terjual dikembalikan lewat alur retur penjualan (Tahap 4).

### 1.4 Booking lama — tombol **Follow up**
- **Apa:** booking yang belum ada tindakan selama **3 hari** muncul di *Needs follow-up*.
- **Fungsi:** booking tidak dibiarkan mengunci unit tanpa kejelasan. Antrean ini baru hilang setelah ada tindakan eksplisit: dibatalkan, dicatat terjual, atau admin menekan *Follow up* dan mengisi tanggal tindak lanjut berikutnya (paling lama 30 hari).

### 1.5 Jual putus — centang baris → **Record sale**
- **Apa:** mencatat penjualan tunai/lunas, satu atau beberapa VIN sekaligus dalam satu SPK.
- **Fungsi:** status jadi *Sold · awaiting pickup*. Motor **masih dihitung stok fisik**, tetapi tidak bisa ditawarkan (tidak masuk *Ready*). Angkanya terlihat di dashboard.

### 1.6 Pengambilan per VIN — **Confirm pickup**
- **Apa:** mencatat motor benar-benar keluar dari showroom.
- **Fungsi:** VIN lengkap tampil besar di dialog. Admin wajib mencentang *"I matched the VIN on the frame"* setelah mencocokkan nomor rangka.
  - Tersimpan: nama penerima, referensi serah terima (opsional, misalnya nomor surat jalan), dan **tanggal + jam WIB** pengambilan (default sekarang, boleh diisi mundur, tidak boleh ke depan).
  - Motor keluar dari stok fisik.
  - SPK dua unit bisa tampil **"1 of 2 picked up"**; VIN satunya tetap fisik dan terkunci.
  - Konfirmasi ulang VIN yang sudah diambil tidak mencatat pengeluaran kedua.

### 1.7 Show unit / pameran — kartu VIN → **Send to show**, menu **Show units**
- **Apa:** motor siap dibawa ke pameran lalu kembali.
- **Fungsi kirim:** isi nama acara, lokasi, **PIC** (dari data pegawai), waktu keluar (WIB), dan rencana tanggal kembali.
  - Motor keluar dari stok fisik dan *Ready*, masuk angka **Out on show**.
  - Showroom asal tetap bisa melacaknya.
- **Daftar *Show units*:**
  - Tab **Out** berisi semua yang masih di luar.
  - Tab **Overdue** berisi yang lewat rencana kembali, dengan label merah *"Overdue · N d"*.
  - Tab **Returned** berisi yang sudah pulang.
- **Fungsi pulang** (*Record return*): isi waktu kembali dan kondisi.
  - Tanpa temuan → langsung *Ready*.
  - Dengan temuan → wajib dideskripsikan. Motor masuk stok fisik berstatus *Inspection*, dan inspeksi *"Back from event"* otomatis muncul di antrean Inspections berisi temuannya.
  - Unit baru kembali *Ready* setelah inspeksi **lulus** dan admin menekan **Release unit** (aturan sama dengan Tahap 2).

### 1.8 Dashboard dan *Needs follow-up* lengkap
- Angka baru: **Sold · awaiting pickup** dan **Out on show**. Setiap angka tetap bisa diklik sampai daftar VIN-nya.
- *Needs follow-up* sekarang berisi:
  - batch belum lengkap
  - selisih identitas
  - inspeksi
  - **booking lama** (link ke SPK)
  - **terjual menunggu diambil** (berapa hari menunggu)
  - **show unit terlambat** (berapa hari)

### 1.9 Penjaga data yang ikut ditambahkan
- **Tanggal tidak boleh mundur:** pencatatan apa pun pada sebuah VIN tidak boleh bertanggal sebelum kejadian terakhir VIN itu, misalnya mengirim ke pameran sebelum unit diterima. Server menolaknya dengan pesan yang menyebut tanggal kejadian terakhir.
- **Dua admin menekan tombol bersamaan** pada baris SPK yang sama (misalnya satu *Cancel*, satu *Record sale*): satu berhasil, yang lain mendapat pesan untuk memuat ulang. Status tidak pernah setengah jadi.
- **Tekan dua kali / jaringan putus lalu kirim ulang:** tidak pernah membuat SPK, penjualan, atau pengambilan ganda.

---

## 2. Cara testing manual (di staging)

**Persiapan (sekali saja)**
1. Merge PR Tahap 3 ke `staging` dan tunggu deploy selesai. Tidak perlu seed ulang.
2. Akun penguji = akun `SMS_SHOWROOM_ADMIN` di **Showroom Jakarta** dari Tahap 2.
3. Pastikan ada minimal **5 unit Ready** di Showroom Jakarta. Kalau belum ada: *Opening Balance* → tempel 5 baris berkeadaan *Siap*, atau ulangi langkah 3–6 Tahap 2.
4. Untuk langkah 3 perlu **dua browser** (misalnya Chrome biasa + jendela Incognito), keduanya login sebagai admin Jakarta.

| # | Langkah | Hasil yang harus terlihat |
|---|---|---|
| 1 | Catat angka dashboard (*Physical*, *Ready*) | Misalnya Physical 5, Ready 5 |
| 2 | *Orders (SPK)* → *New SPK*: nomor `spk-a01`, sales siapa saja, customer "Rina", unit 1 = VIN A, *+ Add another unit* → VIN B → *Create SPK* | Halaman SPK **SPK-A01** (huruf besar), "2 units · 2 booked", Sales dan *Recorded by* terpisah. Dashboard: Ready turun 2, Physical tetap, Booked 2 |
| 3 | **Uji bentrok:** di browser 1 dan 2 buka *New SPK*, isi `SPK-X1` dan `SPK-X2`, sama-sama pilih **VIN C**, lalu tekan *Create SPK* hampir bersamaan | Satu browser pindah ke halaman SPK. Browser lain menampilkan banner di baris VIN C: "Already booked by … for SPK-X…" + daftar *Alternatives* |
| 4 | Di browser yang kalah, klik satu alternatif → *Create SPK* | SPK tersimpan dengan VIN alternatif |
| 5 | Buka **SPK-A01** → baris VIN B → *Cancel* → alasan "Customer ganti warna" | VIN B *Cancelled* dengan alasannya. Kartu VIN B: status *Ready*, timeline berisi pembatalan. VIN A tetap *Booked* |
| 6 | *Add units* di SPK-A01 → pilih VIN D | SPK berisi VIN A dan D *Booked* (B tetap tercatat sebagai batal) |
| 7 | Centang *Select all booked lines* → *Record sale* | A dan D *Sold*. Dashboard: *Sold · awaiting pickup* 2, Physical tidak berubah, Ready tidak bertambah |
| 8 | Baris VIN A → *Confirm pickup* → isi penerima, centang pencocokan VIN → konfirmasi | A *Picked up* dengan jam WIB dan nama penerima. Chip SPK: **"1 of 2 picked up"**. Dashboard: Physical turun 1 |
| 9 | Buka lagi SPK-A01, coba tombol pada VIN A | Tidak ada tombol aksi lagi (sudah diambil). Kartu VIN A: satu kejadian pengambilan saja |
| 10 | Kartu VIN unit siap (VIN E) → *Send to show* → acara "Pameran Mall", lokasi, PIC, waktu keluar **3 hari lalu**, rencana kembali **kemarin** | Toast berhasil. Kartu VIN: *Out at event*, blok acara dengan PIC dan label *Overdue*. Dashboard: *Out on show* 1, Physical turun 1 |
| 11 | Coba ulang langkah 10 di unit lain dengan waktu keluar **sebelum unit itu diterima** | Ditolak: "This date (…) is before the unit's last recorded movement on …" |
| 12 | Menu *Show units* → tab Out dan Overdue | VIN E ada di kedua tab dengan "Overdue · 1d". Dashboard → *Needs follow-up* → *Overdue show units* |
| 13 | *Record return* → kondisi Fair → centang *Unit has findings* → tulis temuan → simpan | Kartu VIN E: status *Inspection*, Physical naik 1. Menu *Inspections* berisi "Back from event" dengan temuan tadi |
| 14 | *Record inspection result* → Passed → lalu *Release unit* | Status *Ready* hanya setelah *Release unit* ditekan |
| 15 | Kirim unit lain ke pameran lalu *Record return* **tanpa** temuan | Langsung *Ready* di Showroom Jakarta |
| 16 | *(Butuh akun kedua di showroom lain)* buka URL SPK-A01 dan URL kartu VIN E | "not found"; SPK dan unit showroom lain tidak terlihat |

> Booking lama baru muncul di *Needs follow-up* 3 hari setelah booking. Untuk mengujinya, cek kembali SPK dari langkah 2 tiga hari kemudian, lalu tekan *Follow up* untuk menundanya.

---

## 3. Rencana Tahap 4 — RTO dan retur

Fitur yang akan terbuka:

| Fitur | Untuk apa | Cara kerjanya nanti |
|---|---|---|
| **Serah terima RTO** | Motor keluar dengan kontrak rent to own | Dari SPK yang sudah booked atau langsung dari unit siap. Isi nomor kontrak (diketik dari dokumen), customer, sales, tanggal serah terima. Maksimal satu kontrak aktif per VIN. Kartu VIN menampilkan histori per periode kontrak |
| **Retur RTO di cabang asal** | Motor dikembalikan atau ditarik | Catat lokasi dan waktu diterima → inspeksi → **penutupan kontrak di SMS** (tanggal, admin, referensi legal). *Release unit* baru aktif setelah kontrak ditutup **dan** inspeksi lulus. Penanda **Bekas RTO** dipertahankan |
| **Retur lintas cabang + titipan** | Rider mengembalikan motor ke showroom lain | Showroom penerima mengajukan retur dan bisa menerima motor sebagai *titipan* (masuk fisik, tidak siap). Admin showroom asal menyetujui atau menolak. Penerimaan resmi memindahkan tanggung jawab. Titipan yang ditolak diserahkan kembali ke rider. Antrean di kedua showroom |
| **Alih milik** | RTO selesai, motor jadi milik customer | Menutup kontrak; motor tetap di customer |
| **Retur penjualan** | Motor terjual dikembalikan customer | Terima fisik → keputusan disetujui/ditolak → inspeksi → lepas |
| **Retur kontrak dari saldo awal** | RTO lama yang dimasukkan lewat Opening Balance | Bisa diproses sama seperti kontrak baru |

Skenario penerimaan yang akan ditutup: **A06, A07, A08, A09, A10, A11** dan **A14 bagian kedua**.

**Perlu persetujuan Anda sebelum Tahap 4 dimulai:** satu migrasi kecil yang hanya *menambah*, yaitu tiga jenis notifikasi baru (`SMS_RETURN_REQUESTED`, `SMS_UNIT_RECEIVED`, `SMS_RTO_OVERDUE`) supaya admin showroom asal diberi tahu saat ada permintaan retur. Tabel RTO dan retur sendiri sudah dibuat di Tahap 2.

---

## Lampiran — bukti verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `pnpm --filter api typecheck` / `pnpm --filter web typecheck` | Bersih |
| `pnpm lint` | 0 error (21 warning lama `no-console` di API + 1 warning lama `<img>` di web, tidak berubah) |
| `pnpm --filter api test` | 738/738 lulus |
| `pnpm --filter api test:integration` (PostgreSQL asli) | 58/58 lulus, termasuk A03 (booking bersamaan), A04, A05, A12, batal vs jual bersamaan, pengambilan bersamaan, tanggal mundur ditolak |
| `pnpm --filter web tour:check` | Lulus |
| `pnpm --filter web build` | Berhasil |
| Browser (Playwright, data lokal) | Alur SPK → bentrok → alternatif → jual → ambil 1 dari 2 → batal → show unit terlambat → pulang dengan temuan → inspeksi. Tidak ada overflow horizontal di 360 / 768 / 1440 px pada dashboard, Orders, New SPK, detail SPK, Show units, dan kartu VIN |
