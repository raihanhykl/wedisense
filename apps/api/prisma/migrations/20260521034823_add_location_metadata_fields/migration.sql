-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "contact_user_id" UUID,
ADD COLUMN     "custom_fields" JSONB,
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(11,7),
ADD COLUMN     "operating_hours" JSONB,
ADD COLUMN     "photo_url" TEXT,
ADD COLUMN     "qr_code_image_url" TEXT;

-- CreateIndex
CREATE INDEX "locations_contact_user_id_idx" ON "locations"("contact_user_id");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_contact_user_id_fkey" FOREIGN KEY ("contact_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
