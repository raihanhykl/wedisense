-- CreateEnum
CREATE TYPE "HandoverType" AS ENUM ('COMPANY_TO_EMPLOYEE', 'EMPLOYEE_TO_EMPLOYEE', 'EMPLOYEE_TO_COMPANY');

-- CreateEnum
CREATE TYPE "HandoverFormStatus" AS ENUM ('DRAFT', 'ISSUED', 'SIGNED', 'CANCELLED');

-- AlterTable
ALTER TABLE "asset_movements" ADD COLUMN     "handover_form_id" UUID;

-- CreateTable
CREATE TABLE "handover_forms" (
    "id" UUID NOT NULL,
    "form_number" TEXT NOT NULL,
    "handover_type" "HandoverType" NOT NULL,
    "status" "HandoverFormStatus" NOT NULL DEFAULT 'DRAFT',
    "handover_date" DATE NOT NULL,
    "it_officer_user_id" UUID NOT NULL,
    "from_user_id" UUID,
    "to_user_id" UUID,
    "acknowledged_by_user_id" UUID,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "party_snapshot" JSONB,
    "purpose" TEXT,
    "notes" TEXT,
    "scan_file_path" TEXT,
    "scan_file_name" TEXT,
    "scan_file_size" INTEGER,
    "scan_uploaded_at" TIMESTAMP(3),
    "scan_uploaded_by_user_id" UUID,
    "pdf_generated_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "handover_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_form_items" (
    "id" UUID NOT NULL,
    "handover_form_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "asset_number" TEXT NOT NULL,
    "asset_name" TEXT NOT NULL,
    "serial_number" TEXT,
    "condition" TEXT NOT NULL,
    "item_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_form_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_number_sequences" (
    "id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "current_sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postal_code" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logo_url" TEXT,
    "document_code" TEXT NOT NULL DEFAULT 'WDS',
    "division_code" TEXT NOT NULL DEFAULT 'IT',
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "handover_forms_form_number_key" ON "handover_forms"("form_number");

-- CreateIndex
CREATE INDEX "handover_forms_status_idx" ON "handover_forms"("status");

-- CreateIndex
CREATE INDEX "handover_forms_handover_type_idx" ON "handover_forms"("handover_type");

-- CreateIndex
CREATE INDEX "handover_forms_handover_date_idx" ON "handover_forms"("handover_date");

-- CreateIndex
CREATE INDEX "handover_forms_it_officer_user_id_idx" ON "handover_forms"("it_officer_user_id");

-- CreateIndex
CREATE INDEX "handover_forms_from_user_id_idx" ON "handover_forms"("from_user_id");

-- CreateIndex
CREATE INDEX "handover_forms_to_user_id_idx" ON "handover_forms"("to_user_id");

-- CreateIndex
CREATE INDEX "handover_forms_created_by_user_id_idx" ON "handover_forms"("created_by_user_id");

-- CreateIndex
CREATE INDEX "handover_forms_deleted_at_idx" ON "handover_forms"("deleted_at");

-- CreateIndex
CREATE INDEX "handover_form_items_asset_id_idx" ON "handover_form_items"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "handover_form_items_handover_form_id_asset_id_key" ON "handover_form_items"("handover_form_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_number_sequences_document_type_year_key" ON "document_number_sequences"("document_type", "year");

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_handover_form_id_fkey" FOREIGN KEY ("handover_form_id") REFERENCES "handover_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_forms" ADD CONSTRAINT "handover_forms_it_officer_user_id_fkey" FOREIGN KEY ("it_officer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_forms" ADD CONSTRAINT "handover_forms_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_forms" ADD CONSTRAINT "handover_forms_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_forms" ADD CONSTRAINT "handover_forms_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_forms" ADD CONSTRAINT "handover_forms_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_forms" ADD CONSTRAINT "handover_forms_scan_uploaded_by_user_id_fkey" FOREIGN KEY ("scan_uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_forms" ADD CONSTRAINT "handover_forms_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_forms" ADD CONSTRAINT "handover_forms_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_form_items" ADD CONSTRAINT "handover_form_items_handover_form_id_fkey" FOREIGN KEY ("handover_form_id") REFERENCES "handover_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_form_items" ADD CONSTRAINT "handover_form_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
