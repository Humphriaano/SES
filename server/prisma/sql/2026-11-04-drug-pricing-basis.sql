-- No existing monetary values, charges or clinical records are rewritten.
ALTER TABLE "Medication"
  ADD COLUMN IF NOT EXISTS "doseUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "priceBasis" TEXT,
  ADD COLUMN IF NOT EXISTS "bottleSizeMl" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "courseQuantity" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "billingQuantity" DECIMAL(10,2);
ALTER TABLE "PriceListItem" ADD COLUMN IF NOT EXISTS "bottleSizeMl" DECIMAL(10,2);
ALTER TABLE "Dispensing"
  ADD COLUMN IF NOT EXISTS "quantityUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "priceBasis" TEXT,
  ADD COLUMN IF NOT EXISTS "billingQuantity" DECIMAL(10,2);
