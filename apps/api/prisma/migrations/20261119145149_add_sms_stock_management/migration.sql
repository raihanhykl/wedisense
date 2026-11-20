-- CreateEnum
CREATE TYPE "SmsUnitStatus" AS ENUM ('AVAILABLE', 'BOOKED', 'SOLD_PENDING_PICKUP', 'PICKED_UP', 'ACTIVE_RTO', 'CUSTODY', 'INSPECTION', 'SHOW_UNIT', 'IDENTITY_MISMATCH');

-- CreateEnum
CREATE TYPE "SmsUnitEventType" AS ENUM ('OPENING_BALANCE', 'RECEIPT_OK', 'RECEIPT_DAMAGED', 'IDENTITY_MISMATCH_FOUND', 'IDENTITY_RESOLVED', 'INSPECTION_STARTED', 'INSPECTION_PASSED', 'INSPECTION_FAILED', 'UNIT_RELEASED', 'BOOKING_CREATED', 'BOOKING_CANCELLED', 'SALE_RECORDED', 'PICKUP_CONFIRMED', 'SALE_RETURN_RECEIVED', 'SALE_RETURN_APPROVED', 'SALE_RETURN_REJECTED', 'RTO_STARTED', 'RTO_RETURNED', 'RTO_OWNERSHIP_TRANSFERRED', 'RTO_CONTRACT_CLOSED', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'CUSTODY_RECEIVED', 'CUSTODY_HANDED_BACK', 'OFFICIAL_RECEIPT_CONFIRMED', 'SHOW_UNIT_DISPATCHED', 'SHOW_UNIT_RETURNED', 'EVENT_VOIDED');

-- CreateEnum
CREATE TYPE "SmsShipmentLineStatus" AS ENUM ('PENDING', 'RECEIVED_OK', 'RECEIVED_DAMAGED', 'DISCREPANCY');

-- CreateEnum
CREATE TYPE "SmsOrderLineStatus" AS ENUM ('BOOKED', 'SOLD', 'PICKED_UP', 'RTO_HANDED_OVER', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "SmsDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SmsRtoReturnKind" AS ENUM ('RETURNED_BY_CUSTOMER', 'REPOSSESSED');

-- CreateEnum
CREATE TYPE "SmsRtoOutcome" AS ENUM ('RETURNED', 'REPOSSESSED', 'OWNERSHIP_TRANSFERRED');

-- CreateEnum
CREATE TYPE "SmsInspectionReason" AS ENUM ('RECEIPT_DAMAGE', 'IDENTITY_MISMATCH', 'RTO_RETURN', 'CROSS_BRANCH_RETURN', 'SALE_RETURN', 'SHOW_UNIT_RETURN', 'OTHER');

-- CreateEnum
CREATE TYPE "SmsInspectionResult" AS ENUM ('PENDING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SmsVehicleCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED');

-- CreateTable
CREATE TABLE "sms_vehicle_models" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_vehicle_variants" (
    "id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "battery_variant" TEXT,
    "color" TEXT NOT NULL,
    "color_hex" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_vehicle_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_shipments" (
    "id" UUID NOT NULL,
    "batch_number" TEXT NOT NULL,
    "delivery_note_number" TEXT NOT NULL DEFAULT '',
    "destination_location_id" UUID NOT NULL,
    "origin_location_id" UUID,
    "dispatch_date" DATE,
    "notes" TEXT,
    "source_file_name" TEXT,
    "column_mapping" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_shipment_lines" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "vin" TEXT NOT NULL,
    "engine_number" TEXT,
    "variant_id" UUID,
    "raw_model" TEXT,
    "raw_variant" TEXT,
    "raw_color" TEXT,
    "source_rows" JSONB NOT NULL,
    "is_expected" BOOLEAN NOT NULL DEFAULT true,
    "receipt_status" "SmsShipmentLineStatus" NOT NULL DEFAULT 'PENDING',
    "discrepancy_notes" TEXT,
    "unit_id" UUID,
    "received_by_user_id" UUID,
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_shipment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_units" (
    "id" UUID NOT NULL,
    "vin" TEXT NOT NULL,
    "engine_number" TEXT,
    "license_plate" TEXT,
    "variant_id" UUID NOT NULL,
    "status" "SmsUnitStatus" NOT NULL,
    "physical_location_id" UUID,
    "responsible_showroom_id" UUID NOT NULL,
    "was_rto" BOOLEAN NOT NULL DEFAULT false,
    "is_opening_balance" BOOLEAN NOT NULL DEFAULT false,
    "shipment_id" UUID,
    "received_at" TIMESTAMP(3),
    "notes" TEXT,
    "active_order_line_id" UUID,
    "open_rto_contract_id" UUID,
    "open_return_request_id" UUID,
    "open_show_loan_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_unit_events" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "unit_id" UUID NOT NULL,
    "event_type" "SmsUnitEventType" NOT NULL,
    "event_date" DATE NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performed_by_user_id" UUID,
    "location_id" UUID,
    "payload" JSONB,
    "status_after" "SmsUnitStatus" NOT NULL,
    "physical_location_after_id" UUID,
    "responsible_showroom_after_id" UUID NOT NULL,
    "shipment_line_id" UUID,
    "order_line_id" UUID,
    "rto_contract_id" UUID,
    "return_request_id" UUID,
    "show_loan_id" UUID,
    "inspection_id" UUID,
    "supersedes_event_id" UUID,
    "voids_event_id" UUID,
    "reason" TEXT,
    "notes" TEXT,
    "attachments" JSONB,

    CONSTRAINT "sms_unit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_orders" (
    "id" UUID NOT NULL,
    "showroom_id" UUID NOT NULL,
    "spk_number" TEXT NOT NULL,
    "sales_user_id" UUID,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "customer_id_number" TEXT,
    "notes" TEXT,
    "is_opening_balance" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "status" "SmsOrderLineStatus" NOT NULL DEFAULT 'BOOKED',
    "booked_at" TIMESTAMP(3) NOT NULL,
    "follow_up_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "sold_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "receiver_name" TEXT,
    "handover_reference" TEXT,
    "rto_handover_at" TIMESTAMP(3),
    "return_received_at" TIMESTAMP(3),
    "return_reason" TEXT,
    "return_condition" "SmsVehicleCondition",
    "return_decision" "SmsDecision",
    "return_decided_at" TIMESTAMP(3),
    "return_decision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_rto_contracts" (
    "id" UUID NOT NULL,
    "contract_number" TEXT NOT NULL,
    "unit_id" UUID NOT NULL,
    "origin_showroom_id" UUID NOT NULL,
    "order_line_id" UUID,
    "sales_user_id" UUID,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "customer_id_number" TEXT,
    "start_date" DATE NOT NULL,
    "handover_at" TIMESTAMP(3),
    "return_kind" "SmsRtoReturnKind",
    "returned_at" TIMESTAMP(3),
    "received_at_showroom_id" UUID,
    "closed_at" TIMESTAMP(3),
    "closed_by_user_id" UUID,
    "legal_reference" TEXT,
    "outcome" "SmsRtoOutcome",
    "notes" TEXT,
    "is_opening_balance" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_rto_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_return_requests" (
    "id" UUID NOT NULL,
    "request_number" TEXT NOT NULL,
    "unit_id" UUID NOT NULL,
    "rto_contract_id" UUID,
    "from_showroom_id" UUID NOT NULL,
    "to_showroom_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" "SmsDecision" NOT NULL DEFAULT 'PENDING',
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "custody_received_at" TIMESTAMP(3),
    "official_received_at" TIMESTAMP(3),
    "custody_resolved_at" TIMESTAMP(3),
    "custody_resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_inspections" (
    "id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "reason" "SmsInspectionReason" NOT NULL,
    "result" "SmsInspectionResult" NOT NULL DEFAULT 'PENDING',
    "condition" "SmsVehicleCondition",
    "odometer" INTEGER,
    "findings" TEXT,
    "notes" TEXT,
    "photos" JSONB,
    "inspector_user_id" UUID,
    "inspected_at" TIMESTAMP(3),
    "rto_contract_id" UUID,
    "return_request_id" UUID,
    "show_loan_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_show_loans" (
    "id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "showroom_id" UUID NOT NULL,
    "event_name" TEXT NOT NULL,
    "event_location" TEXT NOT NULL,
    "pic_user_id" UUID,
    "dispatched_at" TIMESTAMP(3) NOT NULL,
    "expected_return_date" DATE NOT NULL,
    "returned_at" TIMESTAMP(3),
    "return_condition" "SmsVehicleCondition",
    "has_findings" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_show_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sms_vehicle_models_code_key" ON "sms_vehicle_models"("code");

-- CreateIndex
CREATE INDEX "sms_vehicle_models_is_active_idx" ON "sms_vehicle_models"("is_active");

-- CreateIndex
CREATE INDEX "sms_vehicle_variants_model_id_idx" ON "sms_vehicle_variants"("model_id");

-- CreateIndex
CREATE INDEX "sms_vehicle_variants_is_active_idx" ON "sms_vehicle_variants"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sms_vehicle_variants_model_id_name_color_key" ON "sms_vehicle_variants"("model_id", "name", "color");

-- CreateIndex
CREATE INDEX "sms_shipments_batch_number_idx" ON "sms_shipments"("batch_number");

-- CreateIndex
CREATE INDEX "sms_shipments_created_at_idx" ON "sms_shipments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sms_shipments_destination_location_id_batch_number_delivery_key" ON "sms_shipments"("destination_location_id", "batch_number", "delivery_note_number");

-- CreateIndex
CREATE UNIQUE INDEX "sms_shipment_lines_unit_id_key" ON "sms_shipment_lines"("unit_id");

-- CreateIndex
CREATE INDEX "sms_shipment_lines_vin_idx" ON "sms_shipment_lines"("vin");

-- CreateIndex
CREATE INDEX "sms_shipment_lines_shipment_id_receipt_status_idx" ON "sms_shipment_lines"("shipment_id", "receipt_status");

-- CreateIndex
CREATE UNIQUE INDEX "sms_shipment_lines_shipment_id_vin_key" ON "sms_shipment_lines"("shipment_id", "vin");

-- CreateIndex
CREATE UNIQUE INDEX "sms_units_vin_key" ON "sms_units"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "sms_units_active_order_line_id_key" ON "sms_units"("active_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_units_open_rto_contract_id_key" ON "sms_units"("open_rto_contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_units_open_return_request_id_key" ON "sms_units"("open_return_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_units_open_show_loan_id_key" ON "sms_units"("open_show_loan_id");

-- CreateIndex
CREATE INDEX "sms_units_physical_location_id_status_idx" ON "sms_units"("physical_location_id", "status");

-- CreateIndex
CREATE INDEX "sms_units_responsible_showroom_id_status_idx" ON "sms_units"("responsible_showroom_id", "status");

-- CreateIndex
CREATE INDEX "sms_units_variant_id_idx" ON "sms_units"("variant_id");

-- CreateIndex
CREATE INDEX "sms_units_status_idx" ON "sms_units"("status");

-- CreateIndex
CREATE INDEX "sms_units_engine_number_idx" ON "sms_units"("engine_number");

-- CreateIndex
CREATE INDEX "sms_units_license_plate_idx" ON "sms_units"("license_plate");

-- CreateIndex
CREATE UNIQUE INDEX "sms_unit_events_seq_key" ON "sms_unit_events"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "sms_unit_events_supersedes_event_id_key" ON "sms_unit_events"("supersedes_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_unit_events_voids_event_id_key" ON "sms_unit_events"("voids_event_id");

-- CreateIndex
CREATE INDEX "sms_unit_events_unit_id_seq_idx" ON "sms_unit_events"("unit_id", "seq");

-- CreateIndex
CREATE INDEX "sms_unit_events_event_date_idx" ON "sms_unit_events"("event_date");

-- CreateIndex
CREATE INDEX "sms_unit_events_event_type_idx" ON "sms_unit_events"("event_type");

-- CreateIndex
CREATE INDEX "sms_unit_events_order_line_id_idx" ON "sms_unit_events"("order_line_id");

-- CreateIndex
CREATE INDEX "sms_unit_events_rto_contract_id_idx" ON "sms_unit_events"("rto_contract_id");

-- CreateIndex
CREATE INDEX "sms_unit_events_return_request_id_idx" ON "sms_unit_events"("return_request_id");

-- CreateIndex
CREATE INDEX "sms_orders_sales_user_id_idx" ON "sms_orders"("sales_user_id");

-- CreateIndex
CREATE INDEX "sms_orders_created_at_idx" ON "sms_orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sms_orders_showroom_id_spk_number_key" ON "sms_orders"("showroom_id", "spk_number");

-- CreateIndex
CREATE INDEX "sms_order_lines_order_id_idx" ON "sms_order_lines"("order_id");

-- CreateIndex
CREATE INDEX "sms_order_lines_unit_id_idx" ON "sms_order_lines"("unit_id");

-- CreateIndex
CREATE INDEX "sms_order_lines_status_idx" ON "sms_order_lines"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sms_rto_contracts_contract_number_key" ON "sms_rto_contracts"("contract_number");

-- CreateIndex
CREATE INDEX "sms_rto_contracts_unit_id_closed_at_idx" ON "sms_rto_contracts"("unit_id", "closed_at");

-- CreateIndex
CREATE INDEX "sms_rto_contracts_origin_showroom_id_idx" ON "sms_rto_contracts"("origin_showroom_id");

-- CreateIndex
CREATE INDEX "sms_rto_contracts_closed_at_idx" ON "sms_rto_contracts"("closed_at");

-- CreateIndex
CREATE UNIQUE INDEX "sms_return_requests_request_number_key" ON "sms_return_requests"("request_number");

-- CreateIndex
CREATE INDEX "sms_return_requests_unit_id_idx" ON "sms_return_requests"("unit_id");

-- CreateIndex
CREATE INDEX "sms_return_requests_from_showroom_id_decision_idx" ON "sms_return_requests"("from_showroom_id", "decision");

-- CreateIndex
CREATE INDEX "sms_return_requests_to_showroom_id_decision_idx" ON "sms_return_requests"("to_showroom_id", "decision");

-- CreateIndex
CREATE INDEX "sms_inspections_unit_id_created_at_idx" ON "sms_inspections"("unit_id", "created_at");

-- CreateIndex
CREATE INDEX "sms_inspections_result_idx" ON "sms_inspections"("result");

-- CreateIndex
CREATE INDEX "sms_show_loans_unit_id_idx" ON "sms_show_loans"("unit_id");

-- CreateIndex
CREATE INDEX "sms_show_loans_returned_at_expected_return_date_idx" ON "sms_show_loans"("returned_at", "expected_return_date");

-- CreateIndex
CREATE UNIQUE INDEX "sms_idempotency_keys_key_key" ON "sms_idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "sms_idempotency_keys_created_at_idx" ON "sms_idempotency_keys"("created_at");

-- AddForeignKey
ALTER TABLE "sms_vehicle_variants" ADD CONSTRAINT "sms_vehicle_variants_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "sms_vehicle_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_shipments" ADD CONSTRAINT "sms_shipments_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_shipments" ADD CONSTRAINT "sms_shipments_origin_location_id_fkey" FOREIGN KEY ("origin_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_shipments" ADD CONSTRAINT "sms_shipments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_shipment_lines" ADD CONSTRAINT "sms_shipment_lines_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "sms_shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_shipment_lines" ADD CONSTRAINT "sms_shipment_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "sms_vehicle_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_shipment_lines" ADD CONSTRAINT "sms_shipment_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "sms_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_shipment_lines" ADD CONSTRAINT "sms_shipment_lines_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_units" ADD CONSTRAINT "sms_units_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "sms_vehicle_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_units" ADD CONSTRAINT "sms_units_physical_location_id_fkey" FOREIGN KEY ("physical_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_units" ADD CONSTRAINT "sms_units_responsible_showroom_id_fkey" FOREIGN KEY ("responsible_showroom_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_units" ADD CONSTRAINT "sms_units_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "sms_shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_units" ADD CONSTRAINT "sms_units_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_units" ADD CONSTRAINT "sms_units_active_order_line_id_fkey" FOREIGN KEY ("active_order_line_id") REFERENCES "sms_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_units" ADD CONSTRAINT "sms_units_open_rto_contract_id_fkey" FOREIGN KEY ("open_rto_contract_id") REFERENCES "sms_rto_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_units" ADD CONSTRAINT "sms_units_open_return_request_id_fkey" FOREIGN KEY ("open_return_request_id") REFERENCES "sms_return_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_units" ADD CONSTRAINT "sms_units_open_show_loan_id_fkey" FOREIGN KEY ("open_show_loan_id") REFERENCES "sms_show_loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "sms_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_shipment_line_id_fkey" FOREIGN KEY ("shipment_line_id") REFERENCES "sms_shipment_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "sms_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_rto_contract_id_fkey" FOREIGN KEY ("rto_contract_id") REFERENCES "sms_rto_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "sms_return_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_show_loan_id_fkey" FOREIGN KEY ("show_loan_id") REFERENCES "sms_show_loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "sms_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_supersedes_event_id_fkey" FOREIGN KEY ("supersedes_event_id") REFERENCES "sms_unit_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_unit_events" ADD CONSTRAINT "sms_unit_events_voids_event_id_fkey" FOREIGN KEY ("voids_event_id") REFERENCES "sms_unit_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_orders" ADD CONSTRAINT "sms_orders_showroom_id_fkey" FOREIGN KEY ("showroom_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_orders" ADD CONSTRAINT "sms_orders_sales_user_id_fkey" FOREIGN KEY ("sales_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_orders" ADD CONSTRAINT "sms_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_order_lines" ADD CONSTRAINT "sms_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sms_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_order_lines" ADD CONSTRAINT "sms_order_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "sms_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_rto_contracts" ADD CONSTRAINT "sms_rto_contracts_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "sms_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_rto_contracts" ADD CONSTRAINT "sms_rto_contracts_origin_showroom_id_fkey" FOREIGN KEY ("origin_showroom_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_rto_contracts" ADD CONSTRAINT "sms_rto_contracts_received_at_showroom_id_fkey" FOREIGN KEY ("received_at_showroom_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_rto_contracts" ADD CONSTRAINT "sms_rto_contracts_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "sms_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_rto_contracts" ADD CONSTRAINT "sms_rto_contracts_sales_user_id_fkey" FOREIGN KEY ("sales_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_rto_contracts" ADD CONSTRAINT "sms_rto_contracts_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_rto_contracts" ADD CONSTRAINT "sms_rto_contracts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_return_requests" ADD CONSTRAINT "sms_return_requests_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "sms_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_return_requests" ADD CONSTRAINT "sms_return_requests_rto_contract_id_fkey" FOREIGN KEY ("rto_contract_id") REFERENCES "sms_rto_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_return_requests" ADD CONSTRAINT "sms_return_requests_from_showroom_id_fkey" FOREIGN KEY ("from_showroom_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_return_requests" ADD CONSTRAINT "sms_return_requests_to_showroom_id_fkey" FOREIGN KEY ("to_showroom_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_return_requests" ADD CONSTRAINT "sms_return_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_return_requests" ADD CONSTRAINT "sms_return_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_inspections" ADD CONSTRAINT "sms_inspections_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "sms_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_inspections" ADD CONSTRAINT "sms_inspections_inspector_user_id_fkey" FOREIGN KEY ("inspector_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_inspections" ADD CONSTRAINT "sms_inspections_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_inspections" ADD CONSTRAINT "sms_inspections_rto_contract_id_fkey" FOREIGN KEY ("rto_contract_id") REFERENCES "sms_rto_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_inspections" ADD CONSTRAINT "sms_inspections_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "sms_return_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_inspections" ADD CONSTRAINT "sms_inspections_show_loan_id_fkey" FOREIGN KEY ("show_loan_id") REFERENCES "sms_show_loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_show_loans" ADD CONSTRAINT "sms_show_loans_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "sms_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_show_loans" ADD CONSTRAINT "sms_show_loans_showroom_id_fkey" FOREIGN KEY ("showroom_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_show_loans" ADD CONSTRAINT "sms_show_loans_pic_user_id_fkey" FOREIGN KEY ("pic_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_show_loans" ADD CONSTRAINT "sms_show_loans_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
