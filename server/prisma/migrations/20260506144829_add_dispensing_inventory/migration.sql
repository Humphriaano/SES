-- CreateTable
CREATE TABLE "Dispensing" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'direct',
    "dispensedDrug" TEXT NOT NULL,
    "dispensedDose" TEXT,
    "dispensedFrequency" TEXT,
    "dispensedDuration" TEXT,
    "dispensedBy" TEXT NOT NULL,
    "dispensedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "substitution" JSONB,
    "modifications" JSONB,
    "collectedAt" TIMESTAMP(3),
    "collectedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispensing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugInventory" (
    "id" TEXT NOT NULL,
    "drugName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugInventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DrugInventory_drugName_key" ON "DrugInventory"("drugName");

-- AddForeignKey
ALTER TABLE "Dispensing" ADD CONSTRAINT "Dispensing_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispensing" ADD CONSTRAINT "Dispensing_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
