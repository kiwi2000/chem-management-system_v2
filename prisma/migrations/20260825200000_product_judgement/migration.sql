-- 判定結果を保持する。
-- 判定（該当／非該当）と「人が見たかどうか」は別の欄に持つ。
-- 前提が変わったら行ごと作り直す（前の判定も確認済みの状態も残さない）。

CREATE TYPE "JudgementVerdict" AS ENUM ('APPLICABLE', 'NOT_APPLICABLE');
CREATE TYPE "JudgementSource" AS ENUM ('SYSTEM', 'USER');

CREATE TABLE "product_judgements" (
  "id"             TEXT NOT NULL,
  "product_id"     TEXT NOT NULL,
  "category_id"    TEXT NOT NULL,
  "verdict"        "JudgementVerdict" NOT NULL,
  "source"         "JudgementSource" NOT NULL DEFAULT 'SYSTEM',
  "needs_review"   BOOLEAN NOT NULL DEFAULT false,
  "review_reasons" TEXT[],
  "decided_by"     TEXT,
  "decided_at"     TIMESTAMP(3),
  "decided_note"   TEXT,
  "computed_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_judgements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product_judgements"
  ADD CONSTRAINT "product_judgements_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_judgements"
  ADD CONSTRAINT "product_judgements_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "regulation_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "product_judgements_product_id_category_id_key"
  ON "product_judgements"("product_id", "category_id");
CREATE INDEX "product_judgements_category_id_verdict_idx"
  ON "product_judgements"("category_id", "verdict");
CREATE INDEX "product_judgements_needs_review_idx" ON "product_judgements"("needs_review");

CREATE TABLE "product_judgement_hits" (
  "id"                     TEXT NOT NULL,
  "judgement_id"           TEXT NOT NULL,
  "statutory_substance_id" TEXT,
  "pct"                    DECIMAL(9,6) NOT NULL,
  CONSTRAINT "product_judgement_hits_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product_judgement_hits"
  ADD CONSTRAINT "product_judgement_hits_judgement_id_fkey"
  FOREIGN KEY ("judgement_id") REFERENCES "product_judgements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "product_judgement_hits_judgement_id_idx" ON "product_judgement_hits"("judgement_id");
CREATE INDEX "product_judgement_hits_statutory_substance_id_idx" ON "product_judgement_hits"("statutory_substance_id");
