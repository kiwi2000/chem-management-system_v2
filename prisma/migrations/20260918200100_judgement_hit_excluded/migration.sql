-- Judgement evidence keeps the contributions excluded by an impurity pattern (S21).
ALTER TABLE "product_judgement_hits" ADD COLUMN "excluded" JSONB;
