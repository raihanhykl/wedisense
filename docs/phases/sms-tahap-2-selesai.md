# SMS Tahap 2 — Stok Awal dan Penerimaan (selesai)

**Tanggal:** 20 November 2026 · **Branch:** `feat/sms-2-stock-receiving` · **PR:** #12 → `staging`
Acuan: [stock-management-system.md](../specs/stock-management-system.md) · [sms-technical-design.md](../specs/sms-technical-design.md)

Semua layar ada di menu **Stock** (bagian atas sidebar). Menu ini hanya muncul untuk akun yang punya peran stok. Teks layar berbahasa Inggris, sama seperti AMS.

---

## 1. Fitur yang selesai

### 1.1 Akses per showroom
- **Apa:** setiap admin hanya bisa bekerja di showroom tempat ia ditugaskan. Ia bisa diberi akses *lihat saja* ke showroom lain.
- **Fungsi:** admin Bekasi dapat membandingkan stok Jakarta, tetapi tidak bisa menerima, melepas, atau mengubah unit Jakarta. Server yang menegakkannya, bukan hanya tampilan. Unit di showroom yang sama sekali tidak bisa dilihat dijawab "tidak ditemukan", supaya keberadaannya tidak terungkap.
- **Peran siap pakai** (bisa diubah di layar Roles):

  | Peran | Untuk siapa | Cara assign |
  |---|---|---|
  | `SMS_SHOWROOM_ADMIN` | Admin showroom: penerimaan, inspeksi, saldo awal, dan nanti booking, RTO, retur, koreksi, ekspor | Dengan scope showroom |
  | `SMS_CENTRAL_OPS` | Operasional pusat: lihat semua showroom, kelola master produk, ekspor | Tanpa scope (global) |
  | `SMS_SALES` | Sales yang punya akun: cek ketersediaan | Dengan scope showroom |

  `SUPER_ADMIN` otomatis memegang semua izin stok. `ADMIN` milik AMS sengaja tidak.
- **Cara pakai:** Users → edit pegawai → tambah peran → pilih showroom di kolom lokasi.

### 1.2 Master produk — *Product Master*
- **Apa:** daftar model motor dan variannya. Satu varian = model + varian (termasuk varian baterai) + warna.
- **Fungsi:** setiap VIN terikat ke satu varian, sehingga stok bisa dihitung per model, varian, dan warna sesuai permintaan sales.
- **Cara pakai:** Product Master → *Add model* (kode + nama) → *Add variant* (model, nama varian, varian baterai, warna). Model atau varian yang tidak dipakai lagi dinonaktifkan, bukan dihapus. Hanya pemegang izin master (Central Ops / Super Admin) yang bisa mengubah.

### 1.3 Impor manifest pabrik — *Shipments → Import manifest*
- **Apa:** mengubah manifest dari Cikarang menjadi daftar VIN yang **diharapkan datang** ke satu showroom.
- **Fungsi:**
  - VIN yang berulang karena rincian komponen digabung menjadi satu motor; baris sumbernya tetap bisa dilihat.
  - Baris komponen (SN baterai, charger, dll.) tidak pernah menjadi motor.
  - Baris yang tidak jelas ditandai untuk ditinjau admin, tidak dibuang diam-diam.
  - Nol di depan VIN tetap utuh.
  - VIN yang sudah ada di batch ini, di batch lain, atau sudah diterima ditandai dan tidak ditambahkan lagi. Impor ulang file yang sama tidak menambah apa pun.
  - Pemetaan kolom diingat untuk impor berikutnya.
  - Mengimpor belum membuat stok. Stok baru bertambah saat motor dikonfirmasi tiba.
- **Cara pakai:** Shipments → *Import manifest* → isi showroom tujuan, nomor batch, dan surat jalan (sekali saja) → unggah file atau tempel dari Excel → cocokkan kolom → tinjau → *Confirm*.

### 1.4 Penerimaan per VIN — *Shipments → buka batch*
- **Apa:** mencocokkan daftar yang diharapkan dengan motor yang benar-benar tiba.
- **Fungsi:**

  | Kondisi motor | Aksi | Hasil |
  |---|---|---|
  | Tiba dan layak | Centang → *Receive selected* | Masuk stok fisik dan siap ditawarkan |
  | Tiba rusak | *Arrived damaged…* + catatan kerusakan | Masuk stok fisik, tertahan untuk inspeksi |
  | Identitasnya beda dari manifest | *Record a finding…* | Masuk stok fisik, tertahan sampai identitas direkonsiliasi |
  | Belum tiba | Biarkan | Tetap *pending* di batch yang sama dan bisa diterima kapan pun |

  Konfirmasi ulang VIN yang sudah diterima aman; tidak tercatat dua kali. Progres tertulis seperti "9 of 10 arrived · 1 damaged · 1 pending".
- **Cara pakai:** buka batch → cari VIN (bisa dengan beberapa digit terakhir) → centang → *Receive selected* → pilih tanggal terima. Di ponsel, tombolnya menempel di bawah layar.

### 1.5 Inspeksi dan pelepasan — *Inspections* dan kartu VIN
- **Apa:** unit yang tertahan (rusak saat tiba, kelak juga unit retur) diperiksa, lalu dilepas sebagai siap.
- **Fungsi:** unit baru bisa ditawarkan setelah inspeksi **lulus** *dan* admin menekan **Release unit**. Kalau belum bisa dilepas, kartu VIN menuliskan alasannya.
- **Cara pakai:** Inspections (atau kartu VIN) → *Record result* → Passed/Failed, kondisi, odometer, temuan (wajib bila gagal), pemeriksa → simpan. Lalu di kartu VIN → *Release unit*.

### 1.6 *My Showroom Stock* (dashboard)
- **Apa:** layar utama admin untuk showroom yang dipilih.
- **Fungsi:**
  - Angka **Physical** (motor ada di showroom) dan **Ready** (siap ditawarkan), ditambah Booked, Sold awaiting pickup, Inspection, Custody, Identity mismatch, Outside, dan Expected (belum tiba).
  - **Setiap angka bisa diklik** sampai daftar VIN penyusunnya, dan jumlahnya selalu sama.
  - Tabel stok per model, varian, dan warna.
  - Panel *Needs follow-up*: batch parsial, unit dalam inspeksi, selisih identitas.
  - Kotak pencarian VIN, nomor mesin, atau nopol; juga menemukan VIN yang baru diharapkan datang.
- **Cara pakai:** pilih showroom di kanan atas (diingat untuk kunjungan berikutnya) → klik angka mana pun untuk melihat VIN-nya.

### 1.7 Daftar unit dan kartu VIN — *Units*
- **Daftar unit:** filter per tampilan (Physical, Ready, Booked, …), model, varian, dan pencarian. Filter tersimpan di URL, jadi bisa dibagikan dan tombol back tetap bekerja.
- **Kartu VIN:**
  - Urutan informasinya: posisi fisik, showroom penanggung jawab, status, lalu tombol aksi yang memang boleh dilakukan pengguna.
  - Setelah itu identitas, asal batch, riwayat inspeksi, dan **timeline** setiap kejadian (siapa, kapan, di mana). Input terlambat terlihat dari tanggal kejadian vs waktu dicatat.
- **Cara pakai:** klik VIN dari daftar, dashboard, atau hasil pencarian. *Edit details* untuk melengkapi nopol atau nomor mesin.

### 1.8 Impor saldo awal — *Opening Balance*
- **Apa:** memasukkan stok yang sudah ada pada hari peralihan dari Excel.
- **Fungsi:**
  - Setiap baris diberi keadaan: Siap, Booked, Terjual belum diambil, RTO Aktif, Inspeksi, Show unit, atau Titipan.
  - Sistem hanya membuat data yang dibutuhkan keadaan itu: SPK untuk booked/terjual, kontrak untuk RTO, dan **tanpa booking fiktif** untuk RTO aktif.
  - Unit ditandai "Opening balance" karena riwayat sebelumnya tidak ada.
  - Satu baris salah = **tidak ada yang tersimpan**, dan baris salahnya ditunjukkan.
- **Cara pakai:** Opening Balance → *Download template* (ada sheet *Guide*) → isi → unggah atau tempel → pilih showroom dan tanggal hitung stok → tinjau → *Import*.

---

## 2. Cara testing manual (di staging)

**Persiapan (sekali saja)**
1. Merge PR #12 ke `staging` (tunggu deploy selesai).
2. Jalankan seed sistem di staging (dikerjakan Claude) untuk membuat izin dan peran SMS.
3. Login sebagai Super Admin → **Users** → pilih satu akun penguji → tambah peran `SMS_SHOWROOM_ADMIN` dengan lokasi **Showroom Jakarta**. Opsional: akun kedua dengan peran yang sama di showroom lain, untuk uji akses.

| # | Langkah | Hasil yang harus terlihat |
|---|---|---|
| 1 | Sebagai Super Admin: Product Master → buat model `ATHENA` / Athena, lalu varian *Extended · Black* dan *Standard · Black* | Model dan varian muncul di tabel |
| 2 | Login sebagai akun penguji | Menu **Stock** muncul di atas; showroom terpilih Showroom Jakarta |
| 3 | Shipments → *Import manifest* → batch `CK-01` → tab *Paste from Excel* → tempel 5 baris berkolom `Nomor Rangka`, `Nomor Mesin`, `Model`, `Varian`, `Warna`. Tambah 1 baris VIN berulang berjenis "Baterai" dan 1 VIN diawali `000` | Kolom terdeteksi otomatis. Di Review: 5 VIN baru, baris baterai terhitung *Components skipped*, VIN `000…` tampil utuh |
| 4 | *Confirm* → ulangi langkah 3 dengan data yang sama | Pertama: "5 VINs added". Kedua: 0 baru, 5 *Already in this batch* |
| 5 | Dashboard | Physical 0, Ready 0, **Expected 5** |
| 6 | Buka batch `CK-01` → centang 3 VIN → *Receive selected*. VIN ke-4 → *Arrived damaged…* + catatan | Progres "4 of 5 arrived · 1 damaged · 1 pending". Dashboard: **Physical 4, Ready 3, Inspection 1, Expected 1** |
| 7 | Klik angka **Ready** di dashboard | Daftar unit berisi tepat 3 VIN |
| 8 | Centang lagi VIN yang sudah diterima → *Receive selected* | Disebut "already received"; tidak ada unit ganda (Physical tetap 4) |
| 9 | Buka VIN yang rusak (kartu VIN) | Status *Inspection*; *Release unit* belum tersedia dan alasannya tertulis |
| 10 | *Record inspection result* → Passed → simpan → *Release unit* | Status jadi *Ready*; timeline: diterima rusak → inspeksi dibuka → lulus → dilepas. Dashboard Ready 4 |
| 11 | Terima VIN ke-5 di batch yang sama | "5 of 5 arrived"; Physical 5, Ready 5 |
| 12 | Batch → *Record a finding…* → VIN yang tidak ada di manifest | Physical bertambah 1, *Identity mismatch* 1, Ready tidak bertambah |
| 13 | Opening Balance → tempel baris berkolom `VIN, Model, Varian, Warna, Kondisi, Nomor SPK, Nama Customer, Nomor Kontrak`: satu *Siap*, satu *Booked* (SPK + customer), satu *RTO Aktif* (nomor kontrak + customer), satu *RTO Aktif* **tanpa** nomor kontrak | Review menandai baris terakhir dengan pesan jelas; tombol Import terkunci dengan alasannya |
| 14 | Hapus baris yang salah → Import | Unit masuk sesuai keadaan. Unit RTO berstatus *Active RTO*, tidak dihitung fisik (masuk *Outside*), dan kartu VIN-nya hanya berisi "Entered as opening balance" |
| 15 | *(Uji akses, butuh akun kedua di showroom lain)* Buka URL kartu VIN unit Jakarta | "Unit not found or you do not have access"; dashboard showroom lain tidak bisa dipilih |

---

## 3. Rencana Tahap 3 — Booking dan barang keluar

Fitur yang akan terbuka:

| Fitur | Untuk apa | Cara kerjanya nanti |
|---|---|---|
| **SPK multiunit** | Mengamankan unit untuk customer | Isi nomor SPK (diketik dari kertas), customer, dan sales sekali, lalu *Add unit* untuk tiap VIN. VIN langsung terkunci untuk sales itu |
| **Konflik booking** | Dua admin tidak bisa mem-booking VIN yang sama | Tepat satu yang berhasil. Admin kedua melihat "VIN already booked by Dina for SPK-021" beserta pilihan unit lain |
| **Batal booking per VIN** | Customer batal sebagian | Alasan wajib; hanya VIN itu yang kembali siap; booking lama muncul di antrean tindak lanjut |
| **Jual putus** | Mencatat penjualan | Status *Sold · awaiting pickup*; motor tetap stok fisik dan terkunci untuk customer |
| **Pengambilan per VIN** | Mencatat motor keluar | *Confirm pickup* per VIN (penerima, referensi serah terima, waktu). SPK dua unit bisa tampil "1 of 2 picked up"; konfirmasi ulang tidak tercatat dua kali |
| **Show unit** | Motor dibawa ke pameran | Isi acara, lokasi, PIC, rencana kembali → masuk *Outside*. Saat pulang: layak → siap, ada temuan → inspeksi. Lewat jadwal → ditandai terlambat |
| **Needs follow-up lengkap** | Satu antrean kerja harian | Ditambah booking lama, terjual belum diambil, show unit terlambat |

Skenario penerimaan yang ditutup: **A03, A04, A05, A12**.
Tidak perlu migrasi besar: tabel SPK dan show unit sudah dibuat di Tahap 2.
Setelah itu **Tahap 4 — RTO dan retur**: serah terima RTO, retur di cabang asal dan lintas cabang (titipan), penutupan kontrak, pelepasan, alih milik, dan retur penjualan.
