-- Additive: one new table. Nothing existing is changed.
CREATE TABLE "EncounterProcedure" (
  "id" TEXT NOT NULL,
  "encounterId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "catalogueRef" TEXT,
  "name" TEXT NOT NULL,
  "site" TEXT,
  "note" TEXT,
  "performedById" TEXT NOT NULL,
  "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "removedAt" TIMESTAMP(3),
  "removedById" TEXT,
  "removeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EncounterProcedure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EncounterProcedure_status" CHECK ("status" IN ('ACTIVE', 'REMOVED')),
  CONSTRAINT "EncounterProcedure_name" CHECK (length(trim("name")) BETWEEN 2 AND 120),
  CONSTRAINT "EncounterProcedure_removed" CHECK (("status" = 'REMOVED') = ("removedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "EncounterProcedure_encounterId_clientId_key" ON "EncounterProcedure"("encounterId", "clientId");
CREATE INDEX "EncounterProcedure_patientId_performedAt_idx" ON "EncounterProcedure"("patientId", "performedAt");
