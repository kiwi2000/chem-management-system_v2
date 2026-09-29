-- 反応前の写しを展開・CAS 合算した結果（S24、2026-09-30）。
-- 写しを取った時点で作って凍結する。判定には使わず、製品一覧の絞り込み「展開・合算後」が
-- 反応後を入れた製品についても探せるようにするためだけの表

-- CreateTable
CREATE TABLE "product_pre_reaction_expansion_lines" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "cas_normalized" VARCHAR(20),
    "substance_id" TEXT,
    "impurity_type_id" TEXT NOT NULL DEFAULT 'ip-none',
    "total_pct" DECIMAL(9,6) NOT NULL,

    CONSTRAINT "product_pre_reaction_expansion_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_pre_reaction_expansion_lines_product_id_idx" ON "product_pre_reaction_expansion_lines"("product_id");

-- CreateIndex
CREATE INDEX "product_pre_reaction_expansion_lines_cas_normalized_idx" ON "product_pre_reaction_expansion_lines"("cas_normalized");

-- CreateIndex
CREATE INDEX "product_pre_reaction_expansion_lines_substance_id_idx" ON "product_pre_reaction_expansion_lines"("substance_id");

-- AddForeignKey
ALTER TABLE "product_pre_reaction_expansion_lines" ADD CONSTRAINT "product_pre_reaction_expansion_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
