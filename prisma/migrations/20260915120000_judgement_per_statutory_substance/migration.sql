-- 判定の単位を「区分」から「まとめる単位」（区分でまとめる区分は区分、それ以外は法文物質名）に変える
-- （2026-09-15 決定）。区分ごとの判定と人の判断は形が違うので捨て、判定は「全製品を判定し直す」で作り直す。
-- 判断（確認・変更）は引き継がず、判定し直したあと要確認から見直す（決定済み）。

DELETE FROM "product_judgement_hits";
DELETE FROM "product_judgements";
DELETE FROM "product_decisions";

ALTER TABLE "product_judgements" ADD COLUMN "statutory_substance_id" TEXT NOT NULL DEFAULT '';
DROP INDEX "product_judgements_product_id_category_id_version_id_key";
CREATE UNIQUE INDEX "product_judgements_unit_key"
  ON "product_judgements"("product_id", "category_id", "statutory_substance_id", "version_id");
CREATE INDEX "product_judgements_statutory_substance_id_idx"
  ON "product_judgements"("statutory_substance_id");

ALTER TABLE "product_decisions" ADD COLUMN "statutory_substance_id" TEXT NOT NULL DEFAULT '';
DROP INDEX "product_decisions_product_id_category_id_key";
CREATE UNIQUE INDEX "product_decisions_unit_key"
  ON "product_decisions"("product_id", "category_id", "statutory_substance_id");
