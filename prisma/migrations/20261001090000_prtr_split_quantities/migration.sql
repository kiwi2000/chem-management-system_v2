-- PRTR: 数量の入力と排出量の求め方を分ける（2026-10-01 設計。S22）。
-- 製品は所属 × 年度につき 1 行に戻し（印＝排出の数え方は列のまま）、物質ごとの表に取扱量（直接入力）を足す。
-- 実測排出量は任意になる（取扱量だけの行もあるため）

-- 製品は 1 つの印だけ（一意を (頭, 製品) に戻す）
DROP INDEX "prtr_quantities_entry_id_method_product_id_key";
CREATE UNIQUE INDEX "prtr_quantities_entry_id_product_id_key" ON "prtr_quantities"("entry_id", "product_id");

-- 物質ごとの数量: 取扱量（直接入力）を足し、実測排出量を任意にする
ALTER TABLE "prtr_measured" ADD COLUMN "handled_kg" DECIMAL(18,3);
ALTER TABLE "prtr_measured" ALTER COLUMN "measured_kg" DROP NOT NULL;
