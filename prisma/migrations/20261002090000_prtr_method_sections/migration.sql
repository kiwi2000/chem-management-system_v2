-- PRTR: 計算方法ごとの区画（2026-10-02 設計。S22）。
-- 製品ごとの数量は 物質収支／排出係数 の区画ごとに別の行（同じ製品を両方に入れてよい）。
-- 実測値は物質ごとの取扱量（任意）と排出量（必須）。排出量集計は「いまの集計」と「保存した集計（未確定→確定）」を同じ表に持つ

-- 製品の行: 区画ごとに 1 行。「実測で捕捉」の印だった行は物質収支へ
UPDATE "prtr_quantities" SET "method" = 'BALANCE' WHERE "method" = 'MEASURED';
DROP INDEX "prtr_quantities_entry_id_product_id_key";
CREATE UNIQUE INDEX "prtr_quantities_entry_id_method_product_id_key" ON "prtr_quantities"("entry_id", "method", "product_id");

-- 実測値: 排出量は必須（排出量の無い行は取扱量だけの行だったので消す）
DELETE FROM "prtr_measured" WHERE "measured_kg" IS NULL;
ALTER TABLE "prtr_measured" ALTER COLUMN "measured_kg" SET NOT NULL;

-- 集計: 保存した集計の印と確定
ALTER TABLE "prtr_summaries"
  ADD COLUMN "saved_at" TIMESTAMP(3),
  ADD COLUMN "saved_by" TEXT,
  ADD COLUMN "saved_version_code" TEXT,
  ADD COLUMN "saved_factor_pct" DECIMAL(9,4),
  ADD COLUMN "confirmed_at" TIMESTAMP(3),
  ADD COLUMN "confirmed_by" TEXT;
ALTER TABLE "prtr_summary_rows" ADD COLUMN "saved" BOOLEAN NOT NULL DEFAULT false;
DROP INDEX "prtr_summary_rows_summary_id_statutory_substance_id_key";
CREATE UNIQUE INDEX "prtr_summary_rows_summary_id_statutory_substance_id_saved_key" ON "prtr_summary_rows"("summary_id", "statutory_substance_id", "saved");
