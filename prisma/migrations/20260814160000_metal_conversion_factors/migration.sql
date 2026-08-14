-- 金属換算係数。CAS＋金属元素をキーに、重量パーセントを引けるようにする。

CREATE TABLE "metal_conversion_factors" (
    "id" TEXT NOT NULL,
    "cas_number" VARCHAR(20) NOT NULL,
    "cas_normalized" VARCHAR(20) NOT NULL,
    "metal_element" VARCHAR(4) NOT NULL,
    "ratio_pct" DECIMAL(9,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "metal_conversion_factors_pkey" PRIMARY KEY ("id")
);

-- 同じ CAS × 同じ金属元素は1件だけ。
-- 論理削除した行もこの制約に残るので、同じキーで登録し直すときは復活させる（アプリ層）。
CREATE UNIQUE INDEX "metal_conversion_factors_cas_normalized_metal_element_key"
  ON "metal_conversion_factors"("cas_normalized", "metal_element");

CREATE INDEX "metal_conversion_factors_cas_normalized_idx"
  ON "metal_conversion_factors"("cas_normalized");

-- ここから手書き（Prisma が生成できない CHECK 制約）
ALTER TABLE "metal_conversion_factors"
  ADD CONSTRAINT "metal_conversion_factors_ratio_range"
  CHECK ("ratio_pct" > 0 AND "ratio_pct" <= 100);

ALTER TABLE "metal_conversion_factors"
  ADD CONSTRAINT "metal_conversion_factors_element_format"
  CHECK ("metal_element" ~ '^[A-Z][a-z]{0,2}$');
