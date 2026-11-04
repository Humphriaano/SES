-- Stable ledger order for running balances and pagination, independent of
-- transaction-start timestamps or random UUIDs. No quantity is changed.
ALTER TABLE "StockMovement" ADD COLUMN "postingOrder" BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "StockMovement_postingOrder_key" ON "StockMovement"("postingOrder");
CREATE INDEX "StockMovement_batchId_postingOrder_idx" ON "StockMovement"("batchId", "postingOrder");
