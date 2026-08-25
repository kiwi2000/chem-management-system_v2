-- 判定のための土台。
-- 組成を末端まで下ろして CAS でまとめた結果を、製品ごとに保持する。
-- あわせて「まとめかた」を法文物質名と区分に持たせる
-- （CAS ごとに見ると閾値に届かないのに、合計すれば超える、という取りこぼしを防ぐ）。

CREATE TYPE "AggregationMode" AS ENUM ('NONE', 'SUM', 'ELEMENT');

ALTER TABLE "regulation_categories"
  ADD COLUMN "aggregation" "AggregationMode" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "aggregation_element" VARCHAR(4);

ALTER TABLE "statutory_substances"
  ADD COLUMN "aggregation" "AggregationMode" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "aggregation_element" VARCHAR(4);

CREATE TABLE "product_expansions" (
  "product_id"  TEXT NOT NULL,
  "total_pct"   DECIMAL(9,6) NOT NULL,
  "unknown_pct" DECIMAL(9,6) NOT NULL,
  "truncated"   INTEGER NOT NULL DEFAULT 0,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_expansions_pkey" PRIMARY KEY ("product_id")
);

ALTER TABLE "product_expansions"
  ADD CONSTRAINT "product_expansions_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "product_expansion_lines" (
  "id"             TEXT NOT NULL,
  "product_id"     TEXT NOT NULL,
  "cas_normalized" VARCHAR(20),
  "substance_id"   TEXT,
  "total_pct"      DECIMAL(9,6) NOT NULL,
  CONSTRAINT "product_expansion_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product_expansion_lines"
  ADD CONSTRAINT "product_expansion_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product_expansions"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 同じ製品の中で、同じ鍵の行が2つできないようにする
CREATE UNIQUE INDEX "product_expansion_lines_product_id_cas_normalized_substance__key"
  ON "product_expansion_lines"("product_id", "cas_normalized", "substance_id");

-- 逆引き（この CAS を含む製品を全部出す）で引く
CREATE INDEX "product_expansion_lines_cas_normalized_idx" ON "product_expansion_lines"("cas_normalized");
CREATE INDEX "product_expansion_lines_substance_id_idx" ON "product_expansion_lines"("substance_id");
