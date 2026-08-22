-- 国。法令の持ち主になる単位で、地域（アジア・欧州など）の配下に置く。
-- EU・EAEU のような国家連合や、国際条約のように国でないものもここに入れる。
CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "region_id" TEXT NOT NULL,
    "name_ja" VARCHAR(200) NOT NULL,
    "name_en" VARCHAR(200),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "countries_code_normalized_key" ON "countries"("code_normalized");
CREATE INDEX "countries_region_id_display_order_idx" ON "countries"("region_id", "display_order");

ALTER TABLE "countries" ADD CONSTRAINT "countries_region_id_fkey"
    FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- コードは空にしない（他のマスタと同じ約束）
ALTER TABLE "countries" ADD CONSTRAINT "countries_code_not_blank"
  CHECK (length(btrim("code")) > 0 AND length(btrim("code_normalized")) > 0);
