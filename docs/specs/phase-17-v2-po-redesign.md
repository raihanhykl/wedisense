# Feature Specification: Purchase Order (PO) System

---

## 1. PO List Page

### 1.1 Tree Structure
- Tampilkan PO dalam bentuk hierarki: **PO → Batches (≥ 1 batch)**
- Setiap PO memiliki dropdown expander; jika sudah ada batch, klik dropdown untuk menampilkan daftar batch di bawah PO tersebut

---

## 2. PO Detail Page

### 2.2 Currency & Total Amount
- Field **Currency** diganti dari free text menjadi **dropdown** dengan pilihan: IDR, USD, SGD, dan lainnya
- Field **Total Amount** harus otomatis memformat angka sesuai format currency yang dipilih (contoh: IDR → Rp 1.000.000, USD → $1,000.00)

### 2.3 Import PO dari Odoo (PDF Upload)
- Sistem mendukung dua mode input:
  1. **Manual** — isi form secara langsung
  2. **Import dari Odoo** — upload PDF PO dari Odoo
- Setelah PDF di-attach, sistem otomatis mengisi field yang relevan berdasarkan isi dokumen, termasuk:
  - Nomor PO (contoh: `PO/2026/05/00087`)
  - Nama Vendor
  - Buyer (nama user)
  - Order Date
  - Expected Arrival
  - Daftar item produk (dari kolom Description di PDF):
    - Qty per item
    - Unit Price per item
    - Discount % per item
    - Taxes per item
    - Amount per item: `qty × (unit_price − discount) + tax`
  - **Untaxed Amount**: total semua item sebelum pajak
  - **Total Taxes**: total pajak (0 jika semua tax = 0)
  - **Total Amount**: `Untaxed Amount + Total Taxes`

### 2.4 Vendor Name (Database-backed dengan Autocomplete)
- Vendor memiliki database tersendiri dengan alur berikut:
  - Saat mengetik nama vendor yang **belum terdaftar**, muncul opsi **"Simpan Vendor Baru"**
  - Vendor wajib disimpan sebelum PO bisa di-submit; tidak boleh submit tanpa memilih vendor yang sudah terdaftar
  - Saat mengetik nama vendor yang **sudah terdaftar**, tampilkan dropdown autocomplete; user **wajib mengklik** salah satu vendor dari list
  - Gunakan **debounce** saat menampilkan hasil pencarian vendor

### 2.5 Field Products (Database-backed, sama seperti Vendor)
- Product memiliki database tersendiri dengan alur yang sama seperti Vendor (poin 2.4):
  - Autocomplete dengan debounce
  - Bisa pilih product yang sudah ada atau buat product baru
  - Wajib memilih/membuat product sebelum bisa submit
  - Terapkan ini juga di modul asset

### 2.6 Multiple Products
- Mendukung lebih dari satu product per PO
- Tersedia tombol **"+ Add Product"**

### 2.7 Detail per Product Item
Setiap baris product memiliki field berikut:
| Field | Keterangan |
|---|---|
| Product Name | Pilih dari database atau buat baru |
| Qty | Jumlah item |
| Unit Price | Harga satuan |
| Discount | Default `0.00%` |
| Tax | Opsional; input angka % (contoh: 11%, 12%) |
| Amount | `qty × (unit_price − discount) + tax`, dihitung otomatis |

**Summary (dihitung otomatis):**
- **Untaxed Amount**: total amount seluruh item sebelum pajak
- **Total Taxes**: total pajak; `0` jika semua tax = 0%
- **Total Amount**: `Untaxed Amount + Total Taxes`

### 2.8 Tombol Add Procurement Batch
- Tambahkan tombol **"+ Add Procurement Batch"** di halaman PO Detail

---

## 3. Procurement Batch (di bawah PO Detail)

### 3.1 Auto-select Parent PO
- Saat membuka form batch dari halaman PO Detail, field **Parent Purchase Order** otomatis terisi dengan PO saat ini dan **tidak dapat diubah** (disabled)

### 3.2 Batch Name
- Field Batch Name tetap ada dan dapat diisi secara manual

### 3.3 Auto-fill dari Parent PO
Field berikut otomatis terisi dari PO induk dan **tidak dapat diubah** (disabled):
- Purchase Date
- Currency
- Total Amount
- Products
- dan lain lain (silahkan anda tentukan sendiri yang paling sesuai)

### 3.4 Field Products di Batch
- Menampilkan daftar product berdasarkan PO induk

### 3.5 Jumlah Item Diterima per Product
- Setiap product memiliki field **"Qty Received"**:
  - Minimum: `0`
  - Maksimum: `qty` di PO item

### 3.6 Validasi Penyelesaian PO
- PO **tidak dapat di-complete** jika total item yang diterima (across all batches) belum mencapai **100%** dari total qty PO
- *(Validasi ini wajib diterapkan di backend maupun frontend)*

---

## 4. Modul Procurement (Direct Purchase)

- **Hapus modul Procurement** yang ada saat ini
- Untuk direct purchase, user langsung input melalui halaman **`/asset/new`**
  - Di halaman tersebut sudah tersedia input banyak asset sekaligus
  - Mendukung **bulk import via Excel**