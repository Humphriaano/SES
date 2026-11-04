ALTER TABLE "Prescription" ADD COLUMN "preferredStockProductId" TEXT;
CREATE INDEX "Prescription_preferredStockProductId_idx" ON "Prescription"("preferredStockProductId");
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_preferredStockProductId_fkey" FOREIGN KEY ("preferredStockProductId") REFERENCES "PharmacyProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
