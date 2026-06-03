-- DropForeignKey
ALTER TABLE "InvestigationOrder" DROP CONSTRAINT "InvestigationOrder_encounterId_fkey";

-- AlterTable
ALTER TABLE "InvestigationOrder" ALTER COLUMN "encounterId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "InvestigationOrder" ADD CONSTRAINT "InvestigationOrder_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
