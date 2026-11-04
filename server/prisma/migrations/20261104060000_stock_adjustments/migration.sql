CREATE TABLE "StockAdjustment" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reference" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "reason" TEXT,
  "preparedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedById" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "submittedOperationId" TEXT NOT NULL UNIQUE REFERENCES "StockOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "postedOperationId" TEXT UNIQUE REFERENCES "StockOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StockAdjustment_kind" CHECK ("kind" IN ('LOSS','WRITE_OFF','COUNT')),
  CONSTRAINT "StockAdjustment_status" CHECK ("status" IN ('PENDING','POSTED','REJECTED','CANCELLED')),
  CONSTRAINT "StockAdjustment_reference" CHECK (length(trim("reference")) BETWEEN 1 AND 160),
  CONSTRAINT "StockAdjustment_reason_code" CHECK (
    ("kind"='LOSS' AND "reasonCode" IN ('DAMAGE','BREAKAGE','SPILLAGE','THEFT','MISSING','OTHER')) OR
    ("kind"='WRITE_OFF' AND "reasonCode"='EXPIRED') OR
    ("kind"='COUNT' AND "reasonCode" IN ('ROUTINE_COUNT','COUNT_CORRECTION','OTHER'))),
  CONSTRAINT "StockAdjustment_other_reason" CHECK ("reasonCode"<>'OTHER' OR length(trim(COALESCE("reason",'')))>0),
  CONSTRAINT "StockAdjustment_review_fields" CHECK (
    ("status"='PENDING' AND "reviewedById" IS NULL AND "reviewedAt" IS NULL AND "reviewNote" IS NULL AND "postedOperationId" IS NULL) OR
    ("status"='POSTED' AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "postedOperationId" IS NOT NULL AND "reviewedById"<>"preparedById") OR
    ("status" IN ('REJECTED','CANCELLED') AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "postedOperationId" IS NULL)),
  CONSTRAINT "StockAdjustment_rejection_reason" CHECK ("status"<>'REJECTED' OR length(trim(COALESCE("reviewNote",'')))>0)
);
CREATE INDEX "StockAdjustment_status_preparedAt_idx" ON "StockAdjustment"("status","preparedAt");
CREATE TABLE "StockAdjustmentLine" (
  "id" TEXT PRIMARY KEY,
  "adjustmentId" TEXT NOT NULL REFERENCES "StockAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "batchId" TEXT NOT NULL REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "baseUnit" TEXT NOT NULL,
  "expectedQuantity" DECIMAL(18,2) NOT NULL,
  "expectedPostingOrder" BIGINT NOT NULL,
  "countedQuantity" DECIMAL(18,2),
  "changeQuantity" DECIMAL(18,2) NOT NULL,
  "movementId" TEXT UNIQUE REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("adjustmentId","batchId"),
  CONSTRAINT "StockAdjustmentLine_quantities" CHECK ("expectedQuantity">=0 AND "expectedQuantity"<=10000000000 AND "expectedPostingOrder">=0 AND ("countedQuantity" IS NULL OR ("countedQuantity">=0 AND "countedQuantity"<=10000000000)) AND abs("changeQuantity")<=10000000000 AND "expectedQuantity"+"changeQuantity">=0)
);

CREATE FUNCTION "stock_adjustment_header_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; batch_id TEXT;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Stock requests are retained; cancel a pending request'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW."status"<>'PENDING' THEN RAISE EXCEPTION 'A stock request must start pending'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "StockOperation" WHERE "id"=NEW."submittedOperationId" AND "actorId"=NEW."preparedById" AND "kind"='SUBMIT_ADJUSTMENT' AND "response" IS NULL) THEN RAISE EXCEPTION 'Invalid request submission operation'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id"=NEW."preparedById" AND "status"='active' AND string_to_array(replace(COALESCE("role",''),' ',''),',') && ARRAY['admin','pharmacist']) THEN RAISE EXCEPTION 'Pharmacy access required to prepare stock request'; END IF;
    RETURN NEW;
  END IF;
  IF OLD."status"<>'PENDING' OR NEW."status" NOT IN ('POSTED','REJECTED','CANCELLED') OR
    (to_jsonb(NEW)-'status'-'reviewedById'-'reviewedAt'-'reviewNote'-'postedOperationId') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'reviewedById'-'reviewedAt'-'reviewNote'-'postedOperationId') THEN RAISE EXCEPTION 'Stock request details are immutable; submit a new request'; END IF;
  SELECT "role","status" INTO r FROM "User" WHERE "id"=NEW."reviewedById";
  IF r."status" IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Active reviewer required'; END IF;
  IF NEW."status" IN ('POSTED','REJECTED') AND (NEW."reviewedById"=NEW."preparedById" OR NOT ('admin'=ANY(string_to_array(replace(COALESCE(r."role",''),' ',''),',')))) THEN RAISE EXCEPTION 'A different administrator must review this request'; END IF;
  IF NEW."status"='CANCELLED' AND NEW."reviewedById"<>NEW."preparedById" AND NOT ('admin'=ANY(string_to_array(replace(COALESCE(r."role",''),' ',''),','))) THEN RAISE EXCEPTION 'Only its preparer or an administrator can cancel a request'; END IF;
  IF NEW."status"='POSTED' THEN
    IF NOT EXISTS (SELECT 1 FROM "StockOperation" WHERE "id"=NEW."postedOperationId" AND "actorId"=NEW."reviewedById" AND "kind"='APPROVE_ADJUSTMENT' AND "response" IS NULL) THEN RAISE EXCEPTION 'Invalid approval operation'; END IF;
    FOR batch_id IN SELECT "batchId" FROM "StockAdjustmentLine" WHERE "adjustmentId"=NEW."id" ORDER BY "batchId" LOOP
      PERFORM 1 FROM "StockBatch" WHERE "id"=batch_id FOR UPDATE;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StockAdjustment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "StockAdjustment" FOR EACH ROW EXECUTE FUNCTION "stock_adjustment_header_guard"();

CREATE FUNCTION "stock_adjustment_line_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h RECORD; physical_unit TEXT;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Stock request lines are retained'; END IF;
  SELECT * INTO STRICT h FROM "StockAdjustment" WHERE "id"=NEW."adjustmentId";
  IF TG_OP='UPDATE' THEN
    IF OLD."movementId" IS NOT NULL OR NEW."movementId" IS NULL OR h."status"<>'POSTED' OR (to_jsonb(NEW)-'movementId') IS DISTINCT FROM (to_jsonb(OLD)-'movementId') THEN RAISE EXCEPTION 'Stock request lines are immutable'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "StockMovement" WHERE "id"=NEW."movementId" AND "batchId"=NEW."batchId" AND "operationId"=h."postedOperationId" AND "quantity"=NEW."changeQuantity" AND "baseUnit"=NEW."baseUnit" AND "approvedById"=h."reviewedById") THEN RAISE EXCEPTION 'Adjustment movement does not match approved line'; END IF;
    RETURN NEW;
  END IF;
  IF h."status"<>'PENDING' OR NEW."movementId" IS NOT NULL THEN RAISE EXCEPTION 'Only pending requests can receive lines'; END IF;
  IF EXISTS (SELECT 1 FROM "StockOperation" WHERE "id"=h."submittedOperationId" AND "response" IS NOT NULL) THEN RAISE EXCEPTION 'Submitted request lines are immutable'; END IF;
  SELECT p."baseUnit" INTO STRICT physical_unit FROM "StockBatch" b JOIN "PharmacyProduct" p ON p."id"=b."productId" WHERE b."id"=NEW."batchId";
  IF physical_unit<>NEW."baseUnit" THEN RAISE EXCEPTION 'Count unit does not match batch'; END IF;
  IF (h."kind"='COUNT' AND (NEW."countedQuantity" IS NULL OR NEW."changeQuantity"<>NEW."countedQuantity"-NEW."expectedQuantity")) OR (h."kind"<>'COUNT' AND (NEW."countedQuantity" IS NOT NULL OR NEW."changeQuantity">=0)) THEN RAISE EXCEPTION 'Invalid loss or count arithmetic'; END IF;
  IF physical_unit='bottle' AND ((h."kind"='COUNT' AND trunc(NEW."countedQuantity")<>NEW."countedQuantity") OR (h."kind"<>'COUNT' AND trunc(NEW."changeQuantity")<>NEW."changeQuantity")) THEN RAISE EXCEPTION 'Count whole bottles'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StockAdjustmentLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "StockAdjustmentLine" FOR EACH ROW EXECUTE FUNCTION "stock_adjustment_line_guard"();

CREATE FUNCTION "stock_adjustment_movement_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h RECORD; l RECORD; current_qty NUMERIC; current_order BIGINT; expires DATE;
BEGIN
  IF NEW."type"='REVERSAL' AND EXISTS (SELECT 1 FROM "StockAdjustmentLine" WHERE "movementId"=NEW."reversalOfId") THEN RAISE EXCEPTION 'An adjustment correction needs a new independently approved request'; END IF;
  IF NEW."type" NOT IN ('LOSS','ADJUSTMENT') THEN RETURN NEW; END IF;
  SELECT * INTO h FROM "StockAdjustment" WHERE "postedOperationId"=NEW."operationId" AND "status"='POSTED';
  IF h."id" IS NULL THEN RAISE EXCEPTION 'Losses and adjustments require an approved request'; END IF;
  SELECT * INTO l FROM "StockAdjustmentLine" WHERE "adjustmentId"=h."id" AND "batchId"=NEW."batchId";
  IF l."id" IS NULL OR l."movementId" IS NOT NULL OR NEW."quantity"<>l."changeQuantity" OR NEW."baseUnit"<>l."baseUnit" OR NEW."actorId"<>h."reviewedById" OR NEW."approvedById" IS DISTINCT FROM h."reviewedById" OR NEW."type"::text<>(CASE WHEN h."kind"='COUNT' THEN 'ADJUSTMENT' ELSE 'LOSS' END) OR EXISTS (SELECT 1 FROM "StockMovement" WHERE "operationId"=NEW."operationId" AND "batchId"=NEW."batchId" AND "type" IN ('LOSS','ADJUSTMENT')) THEN RAISE EXCEPTION 'Movement does not match approved request'; END IF;
  SELECT "expiryDate" INTO STRICT expires FROM "StockBatch" WHERE "id"=NEW."batchId" FOR UPDATE;
  IF h."kind"='WRITE_OFF' AND expires>=(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lusaka')::date THEN RAISE EXCEPTION 'Only expired stock can be written off as expired'; END IF;
  SELECT COALESCE(SUM("quantity"),0),COALESCE(MAX("postingOrder"),0) INTO current_qty,current_order FROM "StockMovement" WHERE "batchId"=NEW."batchId";
  IF current_qty<>l."expectedQuantity" OR current_order<>l."expectedPostingOrder" THEN RAISE EXCEPTION 'Stock changed since the count or loss request'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StockMovement_adjustment_guard" BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION "stock_adjustment_movement_guard"();

CREATE FUNCTION "stock_adjustment_complete_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h RECORD; l RECORD; current_qty NUMERIC; current_order BIGINT;
BEGIN
  SELECT * INTO STRICT h FROM "StockAdjustment" WHERE "id"=NEW."id";
  IF NOT EXISTS (SELECT 1 FROM "StockOperation" WHERE "id"=h."submittedOperationId" AND "response" IS NOT NULL) OR (h."status"='POSTED' AND NOT EXISTS (SELECT 1 FROM "StockOperation" WHERE "id"=h."postedOperationId" AND "response" IS NOT NULL)) THEN RAISE EXCEPTION 'Stock operation response must be retained atomically'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "StockAdjustmentLine" WHERE "adjustmentId"=h."id") THEN RAISE EXCEPTION 'A stock request needs at least one line'; END IF;
  FOR l IN SELECT * FROM "StockAdjustmentLine" WHERE "adjustmentId"=h."id" LOOP
    IF h."status"='POSTED' THEN
      IF l."changeQuantity"<>0 AND (l."movementId" IS NULL OR NOT EXISTS (SELECT 1 FROM "StockMovement" WHERE "id"=l."movementId" AND "operationId"=h."postedOperationId" AND "quantity"=l."changeQuantity" AND "batchId"=l."batchId" AND "baseUnit"=l."baseUnit")) THEN RAISE EXCEPTION 'Approved request has missing movements'; END IF;
      IF l."changeQuantity"=0 THEN
        SELECT COALESCE(SUM("quantity"),0),COALESCE(MAX("postingOrder"),0) INTO current_qty,current_order FROM "StockMovement" WHERE "batchId"=l."batchId";
        IF l."movementId" IS NOT NULL OR current_qty<>l."expectedQuantity" OR current_order<>l."expectedPostingOrder" THEN RAISE EXCEPTION 'Unchanged count is stale or has an invalid movement'; END IF;
      END IF;
    ELSIF l."movementId" IS NOT NULL THEN RAISE EXCEPTION 'Unapproved request cannot have stock movements'; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "StockAdjustment_complete" AFTER INSERT OR UPDATE ON "StockAdjustment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "stock_adjustment_complete_guard"();
