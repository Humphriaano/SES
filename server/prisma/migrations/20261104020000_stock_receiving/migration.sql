-- Add receiving metadata without changing existing stock or clinical values.
ALTER TABLE "StockReceipt" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_kind" CHECK ("kind" IN ('DELIVERY', 'OPENING'));
ALTER TABLE "CatalogueDrug" ADD COLUMN "ingredients" JSONB;
ALTER TABLE "CatalogueDrug" ADD COLUMN "pendingReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CatalogueDrug" ADD CONSTRAINT "CatalogueDrug_ingredients_array" CHECK ("ingredients" IS NULL OR jsonb_typeof("ingredients") = 'array');
