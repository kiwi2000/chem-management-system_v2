-- 原組成（1段分）。多段の展開結果は別テーブルに持つ（S11）
CREATE TABLE "composition_lines" (
    "id" TEXT NOT NULL,
    "parent_product_id" TEXT NOT NULL,
    "substance_id" TEXT,
    "child_product_id" TEXT,
    "content_pct" DECIMAL(9,6),
    "is_balance" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "composition_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "composition_lines_parent_product_id_idx" ON "composition_lines"("parent_product_id");
CREATE INDEX "composition_lines_substance_id_idx" ON "composition_lines"("substance_id");
CREATE INDEX "composition_lines_child_product_id_idx" ON "composition_lines"("child_product_id");

ALTER TABLE "composition_lines" ADD CONSTRAINT "composition_lines_parent_fkey"
  FOREIGN KEY ("parent_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 参照されているものは物理削除させない（論理削除の前にアプリ側で参照を確認する）
ALTER TABLE "composition_lines" ADD CONSTRAINT "composition_lines_substance_fkey"
  FOREIGN KEY ("substance_id") REFERENCES "substances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "composition_lines" ADD CONSTRAINT "composition_lines_child_product_fkey"
  FOREIGN KEY ("child_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 構成要素は物質か子製品のどちらか一方だけ
ALTER TABLE "composition_lines"
  ADD CONSTRAINT "composition_lines_element_one_of"
  CHECK (("substance_id" IS NOT NULL) <> ("child_product_id" IS NOT NULL));

-- 残部の行は含有率を持たない。それ以外は 0 < 含有率 <= 100
ALTER TABLE "composition_lines"
  ADD CONSTRAINT "composition_lines_pct_by_balance"
  CHECK (
    CASE WHEN "is_balance"
      THEN "content_pct" IS NULL
      ELSE "content_pct" IS NOT NULL AND "content_pct" > 0 AND "content_pct" <= 100
    END
  );
