-- 反応後の組成（S24、2026-09-29）。
-- 「反応後の組成入力」を押した時点の登録組成を反応前として写し取って凍結し、登録組成そのものを反応後として編集する。
-- 判定・合算・出力は従来どおり登録組成（composition_lines）を読むので、押していない製品は何も変わらない

-- AlterTable
ALTER TABLE "products" ADD COLUMN "pre_reaction_at" TIMESTAMP(3),
ADD COLUMN "pre_reaction_by" TEXT;

-- CreateTable
CREATE TABLE "product_pre_reaction_lines" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "substance_id" TEXT,
    "child_product_id" TEXT,
    "content_pct" DECIMAL(9,6),
    "note" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_pre_reaction_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_pre_reaction_lines_product_id_idx" ON "product_pre_reaction_lines"("product_id");

-- CreateIndex
CREATE INDEX "product_pre_reaction_lines_substance_id_idx" ON "product_pre_reaction_lines"("substance_id");

-- CreateIndex
CREATE INDEX "product_pre_reaction_lines_child_product_id_idx" ON "product_pre_reaction_lines"("child_product_id");

-- AddForeignKey
ALTER TABLE "product_pre_reaction_lines" ADD CONSTRAINT "product_pre_reaction_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_pre_reaction_lines" ADD CONSTRAINT "product_pre_reaction_lines_substance_id_fkey" FOREIGN KEY ("substance_id") REFERENCES "substances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_pre_reaction_lines" ADD CONSTRAINT "product_pre_reaction_lines_child_product_id_fkey" FOREIGN KEY ("child_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
