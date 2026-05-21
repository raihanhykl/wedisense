-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProcurementBatchStatus" AS ENUM ('DRAFT', 'ITEMS_PENDING', 'RECEIVED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "procurement_batch_id" UUID;

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'OPEN',
    "vendor" TEXT NOT NULL,
    "vendor_contact" TEXT,
    "po_date" TIMESTAMP(3) NOT NULL,
    "expected_delivery_date" TIMESTAMP(3),
    "po_url" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "total_amount" DECIMAL(15,2),
    "batch_count" INTEGER NOT NULL DEFAULT 0,
    "asset_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "attachments" JSONB,
    "custom_fields" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "closed_by_user_id" UUID,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_batches" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "batch_number" TEXT NOT NULL,
    "name" TEXT,
    "status" "ProcurementBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "bast_number" TEXT,
    "bast_date" TIMESTAMP(3),
    "bast_url" TEXT,
    "invoice_number" TEXT,
    "invoice_date" TIMESTAMP(3),
    "invoice_url" TEXT,
    "tax_invoice_number" TEXT,
    "tax_invoice_date" TIMESTAMP(3),
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "received_date" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "total_amount" DECIMAL(15,2),
    "default_location_id" UUID,
    "default_category_id" UUID,
    "received_by_user_id" UUID,
    "received_by_name" TEXT,
    "received_by_position" TEXT,
    "asset_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "attachments" JSONB,
    "custom_fields" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "completed_by_user_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "procurement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_sequences" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "current_sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_batch_sequences" (
    "id" UUID NOT NULL,
    "year_month" INTEGER NOT NULL,
    "current_sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "procurement_batch_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "purchase_orders_po_number_idx" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_orders_vendor_idx" ON "purchase_orders"("vendor");

-- CreateIndex
CREATE INDEX "purchase_orders_po_date_idx" ON "purchase_orders"("po_date");

-- CreateIndex
CREATE INDEX "purchase_orders_created_by_user_id_idx" ON "purchase_orders"("created_by_user_id");

-- CreateIndex
CREATE INDEX "purchase_orders_deleted_at_idx" ON "purchase_orders"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_batches_batch_number_key" ON "procurement_batches"("batch_number");

-- CreateIndex
CREATE INDEX "procurement_batches_purchase_order_id_idx" ON "procurement_batches"("purchase_order_id");

-- CreateIndex
CREATE INDEX "procurement_batches_batch_number_idx" ON "procurement_batches"("batch_number");

-- CreateIndex
CREATE INDEX "procurement_batches_status_idx" ON "procurement_batches"("status");

-- CreateIndex
CREATE INDEX "procurement_batches_bast_number_idx" ON "procurement_batches"("bast_number");

-- CreateIndex
CREATE INDEX "procurement_batches_invoice_number_idx" ON "procurement_batches"("invoice_number");

-- CreateIndex
CREATE INDEX "procurement_batches_purchase_date_idx" ON "procurement_batches"("purchase_date");

-- CreateIndex
CREATE INDEX "procurement_batches_received_date_idx" ON "procurement_batches"("received_date");

-- CreateIndex
CREATE INDEX "procurement_batches_default_location_id_idx" ON "procurement_batches"("default_location_id");

-- CreateIndex
CREATE INDEX "procurement_batches_default_category_id_idx" ON "procurement_batches"("default_category_id");

-- CreateIndex
CREATE INDEX "procurement_batches_received_by_user_id_idx" ON "procurement_batches"("received_by_user_id");

-- CreateIndex
CREATE INDEX "procurement_batches_created_by_user_id_idx" ON "procurement_batches"("created_by_user_id");

-- CreateIndex
CREATE INDEX "procurement_batches_deleted_at_idx" ON "procurement_batches"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_sequences_year_key" ON "purchase_order_sequences"("year");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_batch_sequences_year_month_key" ON "procurement_batch_sequences"("year_month");

-- CreateIndex
CREATE INDEX "assets_procurement_batch_id_idx" ON "assets"("procurement_batch_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_procurement_batch_id_fkey" FOREIGN KEY ("procurement_batch_id") REFERENCES "procurement_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_batches" ADD CONSTRAINT "procurement_batches_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_batches" ADD CONSTRAINT "procurement_batches_default_location_id_fkey" FOREIGN KEY ("default_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_batches" ADD CONSTRAINT "procurement_batches_default_category_id_fkey" FOREIGN KEY ("default_category_id") REFERENCES "asset_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_batches" ADD CONSTRAINT "procurement_batches_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_batches" ADD CONSTRAINT "procurement_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_batches" ADD CONSTRAINT "procurement_batches_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
