-- CreateTable
CREATE TABLE "InvestigationOrder" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "orderedById" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestigationOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "catalogueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specimen" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "componentsJson" TEXT,
    "sampleReceivedAt" TIMESTAMP(3),
    "sampleReceivedById" TEXT,

    CONSTRAINT "InvestigationOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationResult" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "resultedById" TEXT NOT NULL,
    "resultedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendedById" TEXT,
    "amendedAt" TIMESTAMP(3),
    "resultsJson" TEXT NOT NULL,

    CONSTRAINT "InvestigationResult_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InvestigationOrder" ADD CONSTRAINT "InvestigationOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationOrder" ADD CONSTRAINT "InvestigationOrder_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationOrder" ADD CONSTRAINT "InvestigationOrder_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationOrderItem" ADD CONSTRAINT "InvestigationOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InvestigationOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationResult" ADD CONSTRAINT "InvestigationResult_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InvestigationOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
