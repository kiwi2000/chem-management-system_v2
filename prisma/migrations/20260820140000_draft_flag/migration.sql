-- 「作成中」フラグ。入力の途中で、まだ他の人に使わせたくない状態を表す。
-- 有効／無効（status）とは別の軸。オンの間は組成の候補に出さない。
ALTER TABLE "substances" ADD COLUMN "draft_flag" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products"   ADD COLUMN "draft_flag" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "substances_draft_flag_idx" ON "substances"("draft_flag");
CREATE INDEX "products_draft_flag_idx"   ON "products"("draft_flag");
