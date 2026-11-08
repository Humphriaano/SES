-- The facility this installation serves, and its reporting policy: one row, id 1.
CREATE TABLE "FacilitySetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT '',
    "district" TEXT NOT NULL DEFAULT '',
    "lineListNames" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "FacilitySetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FacilitySetting_single_row" CHECK ("id" = 1)
);

-- Names on line lists stay allowed for clinical roles who ask, as before this setting existed.
INSERT INTO "FacilitySetting" ("id", "name", "district", "lineListNames", "updatedAt") VALUES (1, '', '', true, CURRENT_TIMESTAMP);
