-- PRTR: 排出量算出方法を数量の行に持つ（2026-09-30 指示）。
-- 方法（実測値・物質収支・排出係数）ごとに入力の表を分け、集計は 3 つを足す。
-- これまで所属 × 年度で 1 つだった方法は、既にある数量の行へ写してから列を消す（数字は失わない）

-- 数量: 方法の列を足し、頭の方法を写す
ALTER TABLE "prtr_quantities" ADD COLUMN "method" "PrtrMethod" NOT NULL DEFAULT 'BALANCE';
UPDATE "prtr_quantities" q SET "method" = e."method" FROM "prtr_entries" e WHERE q."entry_id" = e."id";

-- 同じ製品を方法ごとに持てるように、一意の鍵を (頭, 方法, 製品) にする
DROP INDEX "prtr_quantities_entry_id_product_id_key";
CREATE UNIQUE INDEX "prtr_quantities_entry_id_method_product_id_key" ON "prtr_quantities"("entry_id", "method", "product_id");

-- 頭の方法は要らなくなる（係数は所属 × 年度で 1 つのまま）
ALTER TABLE "prtr_entries" DROP COLUMN "method";

-- 集計: 方法は無くなり、係数が足りない印と、排出量の内訳（方法ごと）が増える。集計は開くたびに作り直すので写さない
ALTER TABLE "prtr_summaries" DROP COLUMN "method";
ALTER TABLE "prtr_summaries" ADD COLUMN "factor_missing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "prtr_summary_rows"
  ADD COLUMN "release_measured_kg" DECIMAL(18,3),
  ADD COLUMN "release_balance_kg" DECIMAL(18,3),
  ADD COLUMN "release_factor_kg" DECIMAL(18,3);
