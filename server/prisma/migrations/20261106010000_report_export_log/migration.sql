-- A log of every report exported to Excel. Additive: one new table, nothing existing is touched.
CREATE TABLE "ReportExportLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "role" TEXT,
    "area" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'AGGREGATE',
    "filters" JSONB,
    "rowCount" INTEGER NOT NULL,

    CONSTRAINT "ReportExportLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReportExportLog_kind" CHECK ("kind" IN ('AGGREGATE', 'LINE_LIST')),
    CONSTRAINT "ReportExportLog_rows" CHECK ("rowCount" >= 0)
);

CREATE INDEX "ReportExportLog_at_idx" ON "ReportExportLog"("at");
CREATE INDEX "ReportExportLog_userId_at_idx" ON "ReportExportLog"("userId", "at");

-- An audit log that can be edited is not one: rows can be added, never changed or removed.
CREATE FUNCTION "report_export_log_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The report export log cannot be changed or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReportExportLog_append_only" BEFORE UPDATE OR DELETE ON "ReportExportLog"
  FOR EACH ROW EXECUTE FUNCTION "report_export_log_append_only"();
