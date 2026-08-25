-- 判定の根拠に、その値を作った CAS と、それぞれの寄与を残す。
-- 合算した含有率は、まとめたときだけ意味を持つので null を許す。

ALTER TABLE "product_judgement_hits" DROP COLUMN "pct";
ALTER TABLE "product_judgement_hits" ADD COLUMN "total" DECIMAL(9,6);
ALTER TABLE "product_judgement_hits" ADD COLUMN "contributions" JSONB;
