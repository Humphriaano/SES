-- Procedures can now be ordered by a doctor and done later by a nurse in the treatment room.
-- Existing rows (recorded as done at once) are unchanged: their status stays ACTIVE and they keep their performer.
ALTER TABLE "EncounterProcedure" ALTER COLUMN "performedById" DROP NOT NULL;
ALTER TABLE "EncounterProcedure" ALTER COLUMN "performedAt" DROP NOT NULL;
ALTER TABLE "EncounterProcedure" ALTER COLUMN "performedAt" DROP DEFAULT;
ALTER TABLE "EncounterProcedure"
  ADD COLUMN "orderedById" TEXT,
  ADD COLUMN "orderedAt" TIMESTAMP(3),
  ADD COLUMN "instructions" TEXT,
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'ROUTINE';
ALTER TABLE "EncounterProcedure" DROP CONSTRAINT "EncounterProcedure_status";
ALTER TABLE "EncounterProcedure" DROP CONSTRAINT "EncounterProcedure_removed";
ALTER TABLE "EncounterProcedure"
  ADD CONSTRAINT "EncounterProcedure_status" CHECK ("status" IN ('ORDERED', 'ACTIVE', 'RETURNED', 'CANCELLED', 'REMOVED')),
  ADD CONSTRAINT "EncounterProcedure_priority" CHECK ("priority" IN ('ROUTINE', 'URGENT')),
  ADD CONSTRAINT "EncounterProcedure_ended" CHECK (("status" IN ('RETURNED', 'CANCELLED', 'REMOVED')) = ("removedAt" IS NOT NULL)),
  ADD CONSTRAINT "EncounterProcedure_done" CHECK ("status" <> 'ACTIVE' OR ("performedById" IS NOT NULL AND "performedAt" IS NOT NULL)),
  ADD CONSTRAINT "EncounterProcedure_ordered" CHECK ("status" <> 'ORDERED' OR ("orderedById" IS NOT NULL AND "orderedAt" IS NOT NULL AND "performedAt" IS NULL));
CREATE INDEX "EncounterProcedure_status_orderedAt_idx" ON "EncounterProcedure"("status", "orderedAt");
