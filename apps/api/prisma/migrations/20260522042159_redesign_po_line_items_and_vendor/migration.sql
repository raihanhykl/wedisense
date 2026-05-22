/*
  Warnings:

  - You are about to drop the column `vendor` on the `purchase_orders` table. All the data in the column will be lost.
  - You are about to drop the column `vendor_contact` on the `purchase_orders` table. All the data in the column will be lost.
  - Made the column `purchase_order_id` on table `procurement_batches` required. This step will fail if there are existing NULL values in that column.
  - Made the column `total_amount` on table `procurement_batches` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `vendor_id` to the `purchase_orders` table without a default value. This is not possible if the table is not empty.
  - Made the column `total_amount` on table `purchase_orders` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "procurement_batches" DROP CONSTRAINT "procurement_batches_purchase_order_id_fkey";

-- DropIndex
DROP INDEX "purchase_orders_vendor_idx";

-- AlterTable
ALTER TABLE "procurement_batches" ALTER COLUMN "purchase_order_id" SET NOT NULL,
ALTER COLUMN "total_amount" SET NOT NULL,
ALTER COLUMN "total_amount" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "purchase_orders" DROP COLUMN "vendor",
DROP COLUMN "vendor_contact",
ADD COLUMN     "total_taxes" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "untaxed_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vendor_id" UUID NOT NULL,
ALTER COLUMN "total_amount" SET NOT NULL,
ALTER COLUMN "total_amount" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "contact_person" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "untaxed_amount" DECIMAL(15,2) NOT NULL,
    "tax_amount" DECIMAL(15,2) NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_items" (
    "id" UUID NOT NULL,
    "procurement_batch_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "qty_received" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_name_key" ON "vendors"("name");

-- CreateIndex
CREATE INDEX "vendors_name_idx" ON "vendors"("name");

-- CreateIndex
CREATE INDEX "vendors_is_active_idx" ON "vendors"("is_active");

-- CreateIndex
CREATE INDEX "vendors_deleted_at_idx" ON "vendors"("deleted_at");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_product_id_idx" ON "purchase_order_items"("product_id");

-- CreateIndex
CREATE INDEX "batch_items_procurement_batch_id_idx" ON "batch_items"("procurement_batch_id");

-- CreateIndex
CREATE INDEX "batch_items_purchase_order_item_id_idx" ON "batch_items"("purchase_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "batch_items_procurement_batch_id_purchase_order_item_id_key" ON "batch_items"("procurement_batch_id", "purchase_order_item_id");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "purchase_orders_vendor_id_idx" ON "purchase_orders"("vendor_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_batches" ADD CONSTRAINT "procurement_batches_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_procurement_batch_id_fkey" FOREIGN KEY ("procurement_batch_id") REFERENCES "procurement_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
