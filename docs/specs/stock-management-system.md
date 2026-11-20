# WediSense · Stock Management System

**Handoff produk untuk Claude Code · 19 November 2026**

Wedison mendistribusikan motor dari pabrik assembly Cikarang ke showroom di Indonesia. Admin saat ini mencatat keluar-masuk motor di Excel. Tujuan SMS adalah agar admin dapat menjawab, untuk setiap VIN, **di mana motornya, siapa yang memegangnya, apakah bisa ditawarkan, dan kejadian apa yang membawanya ke kondisi saat ini**. SMS menjadi modul kedua WediSense dan sumber pencatatan stok showroom.

## 1. Mandat implementasi

**Claude Code menentukan ERD dan skema database berdasarkan project saat implementasi.** Baca model, migrasi, alur AMS, otorisasi, dan transaksi yang sudah berjalan. Tentukan representasi data, relasi, kendala integritas, indeks, dan strategi migrasi. Diagram di bawah menjelaskan perilaku aplikasi. Diagram ERD dari sesi brainstorming terdahulu tidak mengikat implementasi.

1. Baca instruksi repo, periksa kondisi branch dan perubahan lokal. Kenali bagian yang khusus untuk aset kantor dan bagian yang bisa dipakai bersama.
2. Susun rancangan teknis beserta ERD pilihanmu. Tunjukkan bagaimana desain menangani satu SPK dengan beberapa VIN, booking bersamaan, histori RTO berulang, dan titipan lintas cabang.
3. Implementasikan alur per tahap pada bagian 9. Hubungkan setiap tahap ke layar yang dipakai admin dan skenario penerimaan pada bagian 10.
4. Laporkan keputusan teknis, hasil verifikasi, dan selisih yang ditemukan saat mencocokkan sampel operasional. Dokumen ini memuat keputusan produk hasil review terakhir.

## 2. Definisi stok

**Satu VIN mewakili satu motor di seluruh jaringan.** Bedakan posisi fisik, showroom penanggung jawab, dan ketersediaan untuk sales. Setiap angka pada tabel adalah kontribusi satu VIN pada saat itu.

| Keadaan VIN | Posisi fisik | Fisik showroom | Siap ditawarkan |
|---|---|---:|---:|
| Tercantum di manifest, belum tiba | Belum diterima | 0 | 0 |
| Diterima di Bekasi dan layak | Bekasi | Bekasi 1 | Bekasi 1 |
| Booked atau terjual menunggu diambil | Bekasi | Bekasi 1 | 0 |
| Sudah diambil, termasuk RTO aktif di customer | Customer | 0 | 0 |
| Show unit di pameran | Acara, dipegang PIC | 0 | 0 |
| Titipan di Jakarta, persetujuan retur tertunda | Jakarta | Jakarta 1 | 0 |
| Retur sudah diterima resmi dan sedang diperiksa | Jakarta | Jakarta 1 | 0 |
| Bekas RTO dilepas admin Jakarta | Jakarta | Jakarta 1 | Jakarta 1 |

Perubahan dari titipan menjadi retur resmi menghasilkan **nol tambahan motor fisik**. Pada RTO yang selesai dengan alih milik kepada customer, saldo fisik showroom juga tetap sama.

## 3. Layar dan navigasi

~~~mermaid
flowchart TD
    Home["Stok Showroom Saya"] --> Search["Cari VIN atau pilih model, varian, dan warna"]
    Home --> In["Terima batch"]
    Home --> Tasks["Perlu ditindaklanjuti"]
    Home --> Report["Rekap stok dan mutasi"]
    Search --> Card["Kartu VIN"]
    In --> Match["Cocokkan manifest dengan motor yang tiba"]
    Tasks --> Match
    Tasks --> Card
    Card --> Action["Aksi sesuai keadaan unit dan izin admin"]
    Card --> History["Riwayat pergerakan dan semua periode kontrak"]
~~~

- **Stok Showroom Saya.** Buka lokasi penugasan admin. Tampilkan fisik dan siap per model, varian dan warna. Sediakan filter booked, terjual belum diambil, inspeksi, titipan, dan sedang di luar. Klik angka untuk membuka VIN penyusunnya.
- **Pencarian.** Cari VIN lengkap/akhir VIN, nomor mesin, nopol, SPK atau nomor kontrak. Bila ada beberapa kecocokan, tampilkan pilihan. Sebelum serah terima, tampilkan VIN lengkap.
- **Kartu VIN.** Dahulukan posisi, pemegang, ketersediaan, dan tindakan yang valid. Tampilkan identitas, batch asal, showroom penanggung jawab, dan penanda bekas RTO. Sediakan timeline pergerakan serta histori per periode kontrak. Bedakan sales pemilik booking dari admin pencatat.
- **Perlu ditindaklanjuti.** Tautkan ke batch parsial, booking yang perlu dikonfirmasi, penjualan menunggu diambil, permintaan retur, titipan, inspeksi, dan show unit melewati rencana kembali.
- **Rekap dan ekspor.** Tampilkan saldo per showroom serta mutasi pada rentang tanggal, dengan asal, tujuan, alasan, dan referensi. Terapkan definisi stok dan izin yang sama pada dashboard, detail, pencarian, serta ekspor.

## 4. Alur operasional

### 4.1 Dari manifest Cikarang ke penerimaan showroom

Admin bisa mengunggah manifest asli atau menempel daftar dari Excel. Nomor batch dan surat jalan cukup diisi sekali untuk bagian pengiriman ke tujuan tersebut.

~~~mermaid
flowchart TD
    A["Pilih sheet dan cocokkan kolom"] --> B["Pratinjau VIN dan nomor baris sumber"]
    B --> C{"Identitas jelas?"}
    C -->|Belum| D["Tinjau duplikat, baris ambigu, atau atribut yang bertentangan"]
    D --> B
    C -->|Sudah| E["Simpan daftar VIN yang diharapkan"]
    E --> F{"Hasil pencocokan fisik per VIN"}
    F -->|Tiba dan layak| G["Terima sebagai siap"]
    F -->|Tiba dengan kerusakan| H["Terima untuk inspeksi"]
    F -->|Belum tiba| I["Biarkan terbuka pada batch yang sama"]
    F -->|Identitas berbeda| J["Catat temuan untuk rekonsiliasi"]
~~~

- Lewati kolom SN baterai dan komponen lain yang tidak diperlukan. Jika VIN dan SN bercampur dalam satu kolom, gunakan penanda jenis barang bila tersedia. Sisakan baris ambigu untuk review admin. Pertahankan karakter pengenal, termasuk nol di awal. Pola kolom yang sering dipakai dapat diingat.
- Kelompokkan VIN berulang akibat rincian komponen sebagai satu calon unit. Tampilkan baris sumber dan konflik nomor mesin, model, varian, atau warna. Saat file diunggah ulang, tunjukkan VIN yang sudah tercantum atau diterima.
- Impor membentuk daftar yang **diharapkan datang**. Admin mengonfirmasi motor yang benar-benar tiba. Bila satu batch pabrik dibagi ke beberapa showroom, masing-masing melihat tujuan dan progres penerimaannya sendiri. Motor dengan identitas berbeda muncul sebagai temuan fisik yang harus direkonsiliasi sebelum ditawarkan.
- Contoh: dari 10 VIN, 9 tiba dan 1 dari 9 lecet. Hasilnya **9 fisik, 8 siap, 1 inspeksi, 1 belum tiba**. Penerimaan susulan dilanjutkan dari batch yang sama.

### 4.2 Booking, jual putus, dan pengambilan

1. Pilih unit siap, sales, customer, dan SPK. Form membuka satu baris unit. Tombol **Tambah unit** menampung kasus satu SPK memesan beberapa motor. Data customer dan sales cukup diisi sekali.
2. Begitu booking disimpan, VIN terkunci untuk sales terkait. Bila dua admin memesan VIN yang sama, satu booking berhasil. Admin kedua mendapat status terbaru dan pilihan unit alternatif. Pembatalan booking dilakukan per VIN dengan alasan. Booking lama muncul untuk ditindaklanjuti sampai ada tindakan eksplisit.
3. Setelah admin mencatat jual putus, tampilkan **Terjual · belum diambil**. Motor tetap ada dalam stok fisik dan terkunci untuk customer. Pembayaran dan pelunasan berada di luar cakupan.
4. Saat motor diserahkan, cocokkan VIN, customer/penerima, sales, dan referensi serah terima. Aksi **Konfirmasi sudah diambil** mencatat waktu keluar dan admin. Status pengambilan berlaku per VIN. Satu SPK dapat menampilkan **1 dari 2 sudah diambil**.
5. Untuk retur penjualan, buka penjualan asal. Catat penerimaan fisik, alasan, kondisi dan keputusan retur. Setelah retur disetujui pihak berwenang dan motor dinyatakan layak, unit boleh ditawarkan kembali.

### 4.3 RTO, penutupan, dan kontrak berikutnya

Saat serah terima rent to own (RTO), admin mengonfirmasi customer, sales, nomor kontrak, tanggal mulai/serah terima dan showroom asal. Motor keluar dari stok fisik. Maksimal satu kontrak aktif per VIN.

Saat motor kembali, bedakan **dikembalikan customer** dan **ditarik**. Catat lokasi serta waktu motor benar-benar diterima. Untuk retur ke showroom asal, admin langsung mencatat penerimaan. Untuk lintas cabang, gunakan alur berikutnya.

Legal menyelesaikan proses kontrak di sistem lain. **Admin sales/showroom berwenang mencatat penutupan kontrak di SMS** setelah menerima konfirmasi dari luar SMS. Simpan tanggal penutupan dan admin pencatat, dengan referensi legal jika tersedia. Pemeriksaan fisik boleh berjalan sambil menunggu konfirmasi legal. Admin melepas unit setelah penerimaan resmi, penutupan kontrak lama, dan inspeksi layak. Pertahankan penanda **Bekas RTO** saat unit kembali siap.

Pada kartu VIN, setiap periode menampilkan customer, sales, tanggal keluar, retur/penarikan, showroom penerima dan hasil akhirnya. Kontrak kedua menambah periode baru. Jika RTO selesai dengan **alih milik ke customer**, catat penyelesaian dan referensinya. Motor tetap di customer.

### 4.4 Retur lintas cabang dan titipan

Contoh: kontrak berasal dari Bekasi, rider ingin menyerahkan motor ke Jakarta. **Cukup satu persetujuan dari admin showroom asal atau supervisor yang berwenang.**

~~~mermaid
sequenceDiagram
    actor J as Admin Jakarta
    participant SMS as WediSense SMS
    actor B as Admin Bekasi atau supervisor
    J->>SMS: Cari VIN dan ajukan retur ke Jakarta
    opt Rider sudah meninggalkan motor
        J->>SMS: Catat titipan dan waktu penerimaan fisik
        SMS-->>J: Jakarta 1 fisik dan 0 siap
    end
    SMS->>B: Tampilkan VIN, asal, tujuan, dan alasan
    alt Disetujui
        B->>SMS: Setujui retur
        J->>SMS: Konfirmasi penerimaan resmi ketika motor ada di Jakarta
        SMS-->>J: Selesaikan titipan bila ada dan buka pemeriksaan
    else Ditolak
        B->>SMS: Tolak dengan alasan
        SMS-->>J: Tampilkan tindak lanjut sesuai posisi fisik terakhir
    end
~~~

- Pengajuan dan persetujuan sebelum motor tiba belum mengubah posisi fisiknya. Jika motor datang lebih dulu, admin mencatat **Titipan · menunggu persetujuan**. Hanya Jakarta yang menghitung fisik motor tersebut.
- Jika ditolak setelah dititipkan, motor tetap fisik di Jakarta dan tertahan sampai ada serah terima nyata kepada rider atau perpindahan lain. Jika ditolak sebelum tiba, unit tetap di pemegang sebelumnya.
- Setelah disetujui dan diterima resmi, admin Jakarta menangani unit. Setelah kontrak lama ditutup di SMS dan pemeriksaan lulus, **Jakarta boleh melepas dan menawarkan kembali motor tersebut**. Riwayat tetap mengidentifikasi Bekasi sebagai showroom asal kontrak pertama.
- Tampilkan permintaan dalam antrean kedua pihak sesuai peran. Simpan pengaju, lokasi asal/tujuan, keputusan, pemberi keputusan, alasan, dan waktu. Beri cabang penerima konteks yang diperlukan untuk memproses VIN terkait.

### 4.5 Show unit dan koreksi

Untuk pameran, pilih VIN siap, isi acara, lokasi, PIC, waktu keluar, dan rencana kembali. Setelah keluar, motor tampil di **Sedang di luar** dan tetap bisa dilacak oleh showroom asal. Saat pulang, admin mencatat penerimaan fisik serta kondisi. Pemeriksaan ringan bisa langsung selesai saat unit layak. Unit dengan temuan masuk antrean inspeksi.

Untuk kesalahan pada transaksi final, supervisor berwenang menyetujui koreksi beralasan. Simpan kejadian asal serta tautan ke koreksi. Periksa dampak terhadap transaksi berikutnya, misalnya penjualan yang sudah diikuti retur. Hasil koreksi harus bisa dijelaskan pada kartu VIN, audit, dan rekap.

## 5. Informasi pada form dan kartu VIN

Ini adalah informasi yang diperlukan pengguna. Claude Code menentukan cara menyimpan atau menurunkannya dari peristiwa operasional.

| Informasi | Kegunaan |
|---|---|
| VIN/nomor rangka, nomor mesin, nopol opsional | Identifikasi lintas showroom dan verifikasi fisik. Nopol dapat dilengkapi kemudian. |
| Model, varian termasuk varian baterai yang relevan, warna | Pilihan terstandar untuk pencarian stok sesuai permintaan sales. Varian produk tetap diperlukan walau SN komponen dilewati saat impor. |
| Batch asal, surat jalan, asal/tujuan, tanggal kirim/terima | Penelusuran dari pabrik hingga penerimaan, termasuk selisih dan penerimaan susulan. |
| Showroom penanggung jawab, lokasi fisik, pemegang/PIC, kondisi, ketersediaan | Menjelaskan siapa menangani unit dan apakah sales dapat menawarkannya. |
| SPK, sales pemilik, customer, waktu booking/tindak lanjut, alasan batal | Pengamanan per VIN dan histori booking. Sales dapat dipilih dari data pegawai meski belum punya login. |
| Customer, kontak sesuai kebutuhan, sales, status pengambilan, waktu dan referensi serah terima | Menelusuri penyerahan masing-masing motor, termasuk pengambilan sebagian dari satu SPK. |
| Nomor kontrak khusus RTO, customer, sales, awal/akhir, hasil akhir, referensi bila tersedia | Memisahkan setiap periode RTO dan menampilkan pihak yang memegang motor pada periode tersebut. |
| Alasan kembali, lokasi/waktu fisik, odometer, kondisi, pemeriksa, hasil inspeksi, foto bila diperlukan | Menilai kelayakan dan menunjukkan kondisi unit bekas. |
| Asal/tujuan permintaan, titipan, persetujuan/penolakan, pelaku dan waktu | Membedakan keputusan lintas cabang dan kejadian fisik. |
| Tanggal kejadian, waktu input otomatis, admin, alasan, dokumen terkait | Melacak input terlambat dan koreksi serta merekonsiliasi mutasi. |

## 6. Hak akses

| Peran | Kewenangan |
|---|---|
| Admin showroom | Mencatat penerimaan, booking, penjualan/pengambilan, RTO, titipan, inspeksi, penutupan kontrak di SMS, pelepasan, dan show unit di lokasi penugasan. Admin asal dapat menyetujui retur lintas cabang. |
| Supervisor | Melihat cabang dalam cakupan tugas, memutuskan retur lintas cabang, menangani retur penjualan, koreksi transaksi final dan selisih. |
| Operasional pusat | Melihat rekap lintas showroom, merekonsiliasi distribusi, mengelola master dan mengekspor sesuai izin. |
| Sales, bila diberi akun | Memeriksa ketersediaan di lokasi yang diizinkan dan booking miliknya. Admin tetap bisa menjalankan seluruh input harian. |

Validasi pasangan **tindakan + lokasi** pada server. Admin Bekasi yang hanya memiliki hak baca Jakarta dapat membandingkan stok, tetapi booking hanya tersedia di Bekasi. Untuk retur lintas cabang, izinkan pencarian terbatas lewat pengenal VIN atau kontrak dan akses sesuai peran pada permintaan tersebut. Batasi akses data customer, detail nasional dan ekspor sesuai kebutuhan tugas.

## 7. Konsistensi dan audit

- Periksa ulang izin, lokasi, booking, kontrak dan ketersediaan saat transaksi disimpan. Tampilkan hasil yang jelas per VIN jika ada konflik pada form multiunit.
- Klik ganda, kirim ulang setelah koneksi terputus, serta impor ulang harus aman. Simpan dampak stok, histori operasional, dan audit terkait secara konsisten. Segarkan tampilan setelah penyimpanan atau konflik.
- Histori operasional menjawab “apa yang terjadi pada motor”. Audit menjawab “siapa mencatat atau mengoreksi dan kapan”. Jaga data customer di hasil pencarian, laporan dan audit.
- Ikuti bahasa antarmuka WediSense. Beri pesan yang dapat ditindaklanjuti, misalnya “VIN ini sudah di-booking Dina untuk SPK-021” jika pengguna berhak melihatnya.

## 8. Titik awal di repo

- [README](../../README.md) dan [instruksi repo](../../CLAUDE.md) menjelaskan monorepo, aturan lokal, dan perintah pengembangan.
- [Skema saat ini](../../apps/api/prisma/schema.prisma), [auth](../../apps/api/src/modules/auth/service.ts), dan [middleware izin](../../apps/api/src/middleware/authorize.ts) menjadi rujukan untuk pegawai, role, lokasi dan otorisasi.
- [Impor aset](../../apps/api/src/modules/assets/import-service.ts) memberi contoh pratinjau dan deduplikasi. [Konvensi audit](../conventions/audit-pattern.md) menjelaskan aturan pencatatan mutasi dan pemeriksaan coverage.
- [Navigasi WediSense](../../apps/web/src/components/shared/app-sidebar.tsx) dan [teks antarmuka](../../packages/shared/locales/) menjadi rujukan untuk akses modul dan bahasa Indonesia/Inggris.
- [Batch pengadaan AMS](../../apps/api/src/modules/procurement-batches/) berkaitan dengan purchase order. Pengiriman motor SMS mengikuti manifest distribusi dari pabrik. Tentukan reuse berdasarkan perilaku yang diperlukan masing-masing modul.

## 9. Tahap development dan peralihan

| Tahap | Pekerjaan | Hasil untuk review |
|---|---|---|
| 1 · Discovery dan desain | Periksa project dan cocokkan contoh manifest, Excel showroom, surat jalan, SPK serta satu VIN yang pernah dua kali RTO. Claude Code menyusun ERD dan desain database. | Contoh pemetaan kolom, penanganan baris ambigu, rancangan teknis dan strategi migrasi. Gunakan contoh sintetis untuk pekerjaan independen sambil menunggu sampel asli. |
| 2 · Stok awal dan penerimaan | Navigasi SMS, akses lokasi, master produk, impor saldo awal, manifest, penerimaan parsial, kartu VIN dan dashboard fisik/siap. | Admin merekonsiliasi satu batch dan menelusuri setiap angka sampai ke VIN. |
| 3 · Booking dan barang keluar | SPK multiunit, konflik booking, pembatalan, jual putus, pengambilan per VIN, dan show unit pergi/pulang. | Admin dapat memproses satu SPK meski unit diambil pada hari berbeda. |
| 4 · RTO dan retur | Serah terima, periode kontrak berulang, retur asal/lintas cabang, titipan, persetujuan, inspeksi, penutupan, pelepasan, alih milik dan retur penjualan. | Satu VIN terlacak dari RTO pertama di Bekasi sampai RTO kedua di Jakarta. |
| 5 · Pilot | Ekspor mutasi, audit, koreksi, pengujian akses dan konkurensi. Pilot di showroom yang aktif RTO dengan cabang pasangan untuk skenario lintas cabang. | Admin menjelaskan saldo fisik, unit siap, booking dan kontrak aktif serta menyelesaikan selisih. |
| 6 · Peralihan | Sepakati tanggal saldo awal setiap showroom. Rekonsiliasi transaksi selama proses impor. Tetapkan SMS sebagai pencatatan utama mulai tanggal peralihan, kemudian perluas per cabang. | Saldo awal disepakati dan setiap transaksi baru tercatat tepat sekali. |

Saldo awal mencakup unit siap, booked, terjual belum diambil, aktif RTO, titipan, inspeksi dan show unit yang masih di luar bila ada. Sertakan referensi kontrak aktif supaya retur setelah peluncuran dapat diproses. Tandai data sebagai saldo awal bila histori terdahulu tidak tersedia.

**Pengembangan lanjutan:** transfer rutin antarshowroom, stock opname dengan scan, dan input manifest langsung oleh pabrik. Retur lintas cabang sudah termasuk pilot. Integrasi legal dan pengelolaan financing berada di luar lingkup versi ini.

## 10. Skenario penerimaan untuk tim development

| ID | Percobaan | Hasil yang harus terlihat |
|---|---|---|
| A01 | Unggah manifest berisi VIN berulang, SN baterai dan satu baris ambigu. Unggah lagi. | Baris sumber dapat ditinjau, komponen tidak menjadi motor, VIN dan penerimaan tidak berganda. |
| A02 | Dari 10 VIN, terima 9 termasuk 1 rusak. Terima 1 susulan yang layak. | Awalnya 9 fisik/8 siap. Akhirnya 10 fisik/9 siap. |
| A03 | Dua admin mencoba booking VIN yang sama bersamaan. | Tepat satu berhasil, admin kedua mendapat status terbaru, dan dashboard sesuai hasil tersimpan. |
| A04 | Catat jual putus dua VIN pada satu SPK. Ambil satu lalu ulangi konfirmasi VIN tersebut. | 1 dari 2 diambil, satu masih fisik, keduanya terkunci, satu pengeluaran tercatat. |
| A05 | Batalkan booking salah satu VIN sebelum penjualan. | Hanya VIN tersebut kembali siap jika layak. Alasan dan histori dapat ditelusuri. |
| A06 | Terima retur RTO di cabang asal. Inspeksi lulus sebelum ada kabar legal. | Fisik bertambah saat diterima. Pelepasan menunggu penutupan kontrak di SMS dan tindakan admin. |
| A07 | Jakarta ajukan retur saat rider masih memegang motor. Admin asal menyetujui. | Fisik belum berubah. Penerimaan fisik sesudahnya menambah tepat satu di Jakarta. |
| A08 | Terima titipan di Jakarta, setujui retur, lalu ulangi konfirmasi resmi. | Awalnya Jakarta 1 fisik/0 siap. Sesudahnya fisik tetap 1. Bekasi tidak ikut menghitung. |
| A09 | Tolak retur dengan titipan, lalu coba kasus lain yang motornya belum tiba. | Kasus pertama menyisakan titipan tertahan di Jakarta. Kasus kedua mempertahankan lokasi di pemegang sebelumnya. Alasan tersimpan. |
| A10 | Supervisor berwenang menyetujui menggantikan admin asal. Jakarta menerima, mencatat penutupan, meluluskan inspeksi dan melepas. | Satu persetujuan cukup. Jakarta bisa memulai RTO kedua. Kedua kontrak dapat dibuka dengan pihak dan hasil masing-masing. |
| A11 | Selesaikan RTO dengan alih milik. Pada VIN lain terima retur jual putus. | Alih milik mempertahankan posisi di customer. Retur jual putus menambah fisik saat diterima dan siap setelah keputusan serta pemeriksaan. |
| A12 | Keluarkan motor ke pameran, lewati jadwal pulang, lalu terima kembali dengan temuan. | PIC dan keterlambatan terlihat. Saat kembali motor masuk fisik dan inspeksi. |
| A13 | Admin Bekasi dengan akses baca Jakarta mencoba booking Jakarta, memberi persetujuan di luar kewenangan, membuka detail terbatas dan ekspor. | Server menegakkan izin pada setiap jalur. Permintaan lintas cabang yang sah tetap bisa diproses. |
| A14 | Impor saldo awal kontrak aktif tanpa booking historis, lalu catat retur. | Retur berfungsi tanpa membuat booking fiktif. Kartu VIN, dashboard, mutasi dan ekspor konsisten. |
| A15 | Koreksi transaksi final yang salah lokasi atau tanggal melalui supervisor. | Transaksi asal, alasan, pelaku, dan dampak koreksi terlihat. Rekap dan histori berikutnya konsisten. |

Jalankan alur melalui antarmuka normal. Verifikasi dengan typecheck, lint, test, dan build sesuai repo saat implementasi. Sebelum peralihan, cocokkan saldo dengan hitungan fisik serta daftar kontrak aktif dan minta admin menelusuri contoh selisih dari dashboard sampai ke VIN.
