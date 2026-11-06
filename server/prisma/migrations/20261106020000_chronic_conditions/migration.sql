-- The chronic condition list as data, with a history of every change. Additive: two new tables.
CREATE TABLE "ChronicCondition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "prefixes" TEXT[],
    "exclude" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ChronicCondition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChronicCondition_key" CHECK ("key" ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT "ChronicCondition_prefixes" CHECK (cardinality("prefixes") BETWEEN 1 AND 30)
);
CREATE UNIQUE INDEX "ChronicCondition_key_key" ON "ChronicCondition"("key");

CREATE TABLE "ChronicConditionHistory" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conditionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "ChronicConditionHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChronicConditionHistory_action" CHECK ("action" IN ('CREATE', 'UPDATE', 'REVIEW')),
    CONSTRAINT "ChronicConditionHistory_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "ChronicCondition"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ChronicConditionHistory_conditionId_at_idx" ON "ChronicConditionHistory"("conditionId", "at");

CREATE FUNCTION "chronic_condition_history_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The chronic condition history cannot be changed or deleted.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ChronicConditionHistory_append_only" BEFORE UPDATE OR DELETE ON "ChronicConditionHistory"
  FOR EACH ROW EXECUTE FUNCTION "chronic_condition_history_append_only"();

-- The starter list the reports have used so far, for a clinical lead to review. None of them is marked reviewed.
INSERT INTO "ChronicCondition" ("id", "key", "label", "prefixes", "exclude", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'hypertension', 'Hypertension', ARRAY['BA00', 'BA01', 'BA02', 'BA04'], ARRAY[]::TEXT[], 10, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'diabetes', 'Diabetes mellitus', ARRAY['5A10', '5A11', '5A13', '5A14'], ARRAY[]::TEXT[], 20, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hiv', 'HIV disease', ARRAY['1C60', '1C61', '1C62'], ARRAY[]::TEXT[], 30, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'asthma', 'Asthma', ARRAY['CA23'], ARRAY[]::TEXT[], 40, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'copd', 'Chronic obstructive pulmonary disease', ARRAY['CA22'], ARRAY[]::TEXT[], 50, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'epilepsy', 'Epilepsy', ARRAY['8A60', '8A61', '8A62'], ARRAY[]::TEXT[], 60, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'heart_failure', 'Heart failure', ARRAY['BD10', 'BD11'], ARRAY[]::TEXT[], 70, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ckd', 'Chronic kidney disease', ARRAY['GB61'], ARRAY[]::TEXT[], 80, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'sickle_cell', 'Sickle cell disease', ARRAY['3A51'], ARRAY['3A51.0'], 90, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'depression', 'Depression', ARRAY['6A70', '6A71'], ARRAY[]::TEXT[], 100, CURRENT_TIMESTAMP);
