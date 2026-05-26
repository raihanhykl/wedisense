-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "vendor_id" UUID;

-- CreateIndex
CREATE INDEX "assets_vendor_id_idx" ON "assets"("vendor_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
