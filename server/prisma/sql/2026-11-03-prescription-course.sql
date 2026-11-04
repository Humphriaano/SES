-- Additive course metadata. Existing prescriptions retain null values and
-- continue using their existing duration/quantity-review behaviour.
ALTER TABLE "Medication"
  ADD COLUMN IF NOT EXISTS "durationDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "unitsPerDose" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "quantity" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "quantityUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "quantityManual" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "unitPrice" DECIMAL(12,2);

ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "substituteMedicationId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Prescription_substituteMedicationId_fkey') THEN
    ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_substituteMedicationId_fkey"
      FOREIGN KEY ("substituteMedicationId") REFERENCES "Medication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE "Dispensing"
  ADD COLUMN IF NOT EXISTS "quantity" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "unitPrice" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "catalogueCode" TEXT;

ALTER TABLE "Medication" ADD COLUMN IF NOT EXISTS "durationCount" INTEGER;
ALTER TABLE "Medication" ADD COLUMN IF NOT EXISTS "durationUnit" TEXT;
