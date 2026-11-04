-- CreateEnum
CREATE TYPE "StockBatchStatus" AS ENUM ('USABLE', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIVED', 'ISSUED', 'LOSS', 'ADJUSTMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "PharmacyProduct" (
    "id" TEXT NOT NULL,
    "catalogueType" "PriceItemType" NOT NULL DEFAULT 'DRUG',
    "catalogueRef" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "brandKey" TEXT NOT NULL,
    "manufacturer" TEXT,
    "manufacturerKey" TEXT NOT NULL DEFAULT '',
    "baseUnit" TEXT NOT NULL,
    "packSize" DECIMAL(18,2) NOT NULL,
    "packLabel" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBatch" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiryDate" DATE NOT NULL,
    "status" "StockBatchStatus" NOT NULL DEFAULT 'USABLE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOperation" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceipt" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "receivedDate" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "packCount" DECIMAL(18,2) NOT NULL,
    "packSize" DECIMAL(18,2) NOT NULL,
    "packLabel" TEXT NOT NULL,
    "baseQuantity" DECIMAL(18,2) NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "costPerPack" DECIMAL(18,2),

    CONSTRAINT "StockReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(18,2) NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "approvedById" TEXT,
    "receiptLineId" TEXT,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDispensingAllocation" (
    "id" TEXT NOT NULL,
    "dispensingId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "quantity" DECIMAL(18,2) NOT NULL,
    "baseUnit" TEXT NOT NULL,

    CONSTRAINT "StockDispensingAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PharmacyProduct_catalogueRef_active_idx" ON "PharmacyProduct"("catalogueRef", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyProduct_identity_key" ON "PharmacyProduct"("catalogueRef", "brandKey", "manufacturerKey", "baseUnit", "packSize");

-- CreateIndex
CREATE INDEX "StockBatch_expiryDate_status_idx" ON "StockBatch"("expiryDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockBatch_productId_lotNumber_key" ON "StockBatch"("productId", "lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockOperation_actorId_key_key" ON "StockOperation"("actorId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceipt_operationId_key" ON "StockReceipt"("operationId");

-- CreateIndex
CREATE INDEX "StockReceipt_receivedDate_idx" ON "StockReceipt"("receivedDate");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceiptLine_receiptId_batchId_key" ON "StockReceiptLine"("receiptId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_receiptLineId_key" ON "StockMovement"("receiptLineId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_reversalOfId_key" ON "StockMovement"("reversalOfId");

-- CreateIndex
CREATE INDEX "StockMovement_batchId_createdAt_id_idx" ON "StockMovement"("batchId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockDispensingAllocation_movementId_key" ON "StockDispensingAllocation"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDispensingAllocation_dispensingId_batchId_key" ON "StockDispensingAllocation"("dispensingId", "batchId");

-- AddForeignKey
ALTER TABLE "PharmacyProduct" ADD CONSTRAINT "PharmacyProduct_catalogueType_catalogueRef_fkey" FOREIGN KEY ("catalogueType", "catalogueRef") REFERENCES "PriceListItem"("itemType", "catalogueRef") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PharmacyProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "StockOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "StockOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "StockReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDispensingAllocation" ADD CONSTRAINT "StockDispensingAllocation_dispensingId_fkey" FOREIGN KEY ("dispensingId") REFERENCES "Dispensing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDispensingAllocation" ADD CONSTRAINT "StockDispensingAllocation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDispensingAllocation" ADD CONSTRAINT "StockDispensingAllocation_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Physical units are independent of how the medicine is priced. No mutable
-- balance columns and no changes to existing clinical or financial tables.
ALTER TABLE "PharmacyProduct" ADD CONSTRAINT "PharmacyProduct_drug_only" CHECK ("catalogueType" = 'DRUG');
ALTER TABLE "PharmacyProduct" ADD CONSTRAINT "PharmacyProduct_valid_pack" CHECK ("packSize" > 0 AND "packSize" <= 10000000000);
ALTER TABLE "PharmacyProduct" ADD CONSTRAINT "PharmacyProduct_physical_unit" CHECK ("baseUnit" IN ('tablet','capsule','sachet','vial','ampoule','tube','inhaler','patch','suppository','pessary','bottle','mL','unit'));
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_valid_conversion" CHECK ("packCount" > 0 AND "packSize" > 0 AND "baseQuantity" > 0 AND "baseQuantity" = "packCount" * "packSize" AND ("costPerPack" IS NULL OR "costPerPack" >= 0));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_nonzero" CHECK ("quantity" <> 0 AND abs("quantity") <= 10000000000);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_direction" CHECK (("type" <> 'RECEIVED' OR "quantity" > 0) AND ("type" NOT IN ('ISSUED','LOSS') OR "quantity" < 0));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_source" CHECK (("type" = 'RECEIVED') = ("receiptLineId" IS NOT NULL) AND ("type" = 'REVERSAL') = ("reversalOfId" IS NOT NULL));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reason" CHECK ("type" NOT IN ('LOSS','ADJUSTMENT','REVERSAL') OR length(trim(COALESCE("reason",''))) > 0);
ALTER TABLE "StockDispensingAllocation" ADD CONSTRAINT "StockDispensingAllocation_positive" CHECK ("quantity" > 0);

CREATE FUNCTION "stock_reject_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted stock records are immutable; use a correcting movement';
END;
$$;
CREATE TRIGGER "StockMovement_immutable" BEFORE UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION "stock_reject_mutation"();
CREATE TRIGGER "StockReceipt_immutable" BEFORE UPDATE OR DELETE ON "StockReceipt" FOR EACH ROW EXECUTE FUNCTION "stock_reject_mutation"();
CREATE TRIGGER "StockReceiptLine_immutable" BEFORE UPDATE OR DELETE ON "StockReceiptLine" FOR EACH ROW EXECUTE FUNCTION "stock_reject_mutation"();
CREATE TRIGGER "StockDispensingAllocation_immutable" BEFORE UPDATE OR DELETE ON "StockDispensingAllocation" FOR EACH ROW EXECUTE FUNCTION "stock_reject_mutation"();

-- Also enforce unit consistency and nonnegative balances at the database
-- boundary. All writers serialize on the batch row, including different Rx's.
CREATE FUNCTION "stock_validate_movement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_record RECORD;
  original_record RECORD;
  receipt_record RECORD;
  current_balance numeric;
BEGIN
  SELECT p."baseUnit", p."active", b."status", b."expiryDate" INTO STRICT batch_record
    FROM "StockBatch" b JOIN "PharmacyProduct" p ON p."id" = b."productId"
    WHERE b."id" = NEW."batchId" FOR UPDATE OF b;
  IF NEW."baseUnit" <> batch_record."baseUnit" THEN RAISE EXCEPTION 'Stock unit does not match product'; END IF;
  IF NEW."type" = 'ISSUED' AND (NOT batch_record."active" OR batch_record."status" <> 'USABLE' OR batch_record."expiryDate" < (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lusaka')::date) THEN
    RAISE EXCEPTION 'Cannot issue inactive, quarantined or expired stock';
  END IF;
  IF NEW."type" = 'RECEIVED' THEN
    SELECT "batchId", "baseUnit", "baseQuantity" INTO STRICT receipt_record FROM "StockReceiptLine" WHERE "id" = NEW."receiptLineId";
    IF receipt_record."batchId" <> NEW."batchId" OR receipt_record."baseUnit" <> NEW."baseUnit" OR receipt_record."baseQuantity" <> NEW."quantity" THEN RAISE EXCEPTION 'Receipt movement does not match its line'; END IF;
  END IF;
  IF NEW."type" = 'REVERSAL' THEN
    SELECT "batchId", "quantity", "type" INTO STRICT original_record FROM "StockMovement" WHERE "id" = NEW."reversalOfId";
    IF original_record."type" = 'REVERSAL' OR original_record."batchId" <> NEW."batchId" OR original_record."quantity" <> -NEW."quantity" THEN RAISE EXCEPTION 'Reversal does not correct its source'; END IF;
    IF EXISTS (SELECT 1 FROM "StockDispensingAllocation" WHERE "movementId" = NEW."reversalOfId") THEN RAISE EXCEPTION 'Dispensing needs a coordinated correction'; END IF;
  END IF;
  SELECT COALESCE(SUM("quantity"),0) INTO current_balance FROM "StockMovement" WHERE "batchId" = NEW."batchId";
  IF current_balance + NEW."quantity" < 0 THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StockMovement_validate" BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION "stock_validate_movement"();

CREATE FUNCTION "stock_validate_allocation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."id" = NEW."movementId" AND m."batchId" = NEW."batchId" AND m."baseUnit" = NEW."baseUnit" AND m."type" = 'ISSUED' AND m."quantity" = -NEW."quantity") THEN RAISE EXCEPTION 'Allocation does not match its stock issue'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StockDispensingAllocation_validate" BEFORE INSERT ON "StockDispensingAllocation" FOR EACH ROW EXECUTE FUNCTION "stock_validate_allocation"();

