-- PRTR summary (S22, 2026-09-21): one per organisation x fiscal year, rebuilt and saved on every totals run.
CREATE TABLE "prtr_summaries" (
  "id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "version_id" TEXT,
  "method" "PrtrMethod" NOT NULL,
  "factor_pct" DECIMAL(9,4),
  "product_count" INTEGER NOT NULL,
  "unjudged_products" INTEGER NOT NULL,
  "threshold_kg" DECIMAL(18,3) NOT NULL,
  "threshold_specific_kg" DECIMAL(18,3) NOT NULL,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "computed_by" TEXT,
  CONSTRAINT "prtr_summaries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prtr_summaries_entry_id_key" ON "prtr_summaries"("entry_id");
ALTER TABLE "prtr_summaries" ADD CONSTRAINT "prtr_summaries_entry_id_fkey"
  FOREIGN KEY ("entry_id") REFERENCES "prtr_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prtr_summaries" ADD CONSTRAINT "prtr_summaries_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "link_set_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One row per Class I designated substance (Specified Class I merged into the same statutory number).
CREATE TABLE "prtr_summary_rows" (
  "id" TEXT NOT NULL,
  "summary_id" TEXT NOT NULL,
  "statutory_substance_id" TEXT NOT NULL,
  "specific" BOOLEAN NOT NULL,
  "product_count" INTEGER NOT NULL,
  "handled_kg" DECIMAL(18,3) NOT NULL,
  "shipped_kg" DECIMAL(18,3),
  "release_kg" DECIMAL(18,3),
  "needs_report" BOOLEAN NOT NULL,
  CONSTRAINT "prtr_summary_rows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prtr_summary_rows_summary_id_statutory_substance_id_key"
  ON "prtr_summary_rows"("summary_id", "statutory_substance_id");
CREATE INDEX "prtr_summary_rows_statutory_substance_id_idx" ON "prtr_summary_rows"("statutory_substance_id");
ALTER TABLE "prtr_summary_rows" ADD CONSTRAINT "prtr_summary_rows_summary_id_fkey"
  FOREIGN KEY ("summary_id") REFERENCES "prtr_summaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prtr_summary_rows" ADD CONSTRAINT "prtr_summary_rows_statutory_substance_id_fkey"
  FOREIGN KEY ("statutory_substance_id") REFERENCES "statutory_substances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
