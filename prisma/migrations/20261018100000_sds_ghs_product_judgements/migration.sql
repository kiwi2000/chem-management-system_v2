-- SDS 版: 製品の GHS 判定の結果（製品 × 国で 1 行。S27 §5 の 4）
CREATE TABLE "sds_ghs_product_judgements" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "country" VARCHAR(20) NOT NULL,
    "ruleset_name" VARCHAR(60) NOT NULL,
    "ruleset_version" INTEGER NOT NULL,
    "as_of" VARCHAR(10) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "computed_by" TEXT,
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sds_ghs_product_judgements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sds_ghs_product_judgements_product_id_country_key" ON "sds_ghs_product_judgements"("product_id", "country");
ALTER TABLE "sds_ghs_product_judgements" ADD CONSTRAINT "sds_ghs_product_judgements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
