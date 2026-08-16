-- 製品 / 原材料マスタを追加する。
-- あわせて拡張属性の項目定義を物質と製品で共有できるようにする
-- （substance_property_defs → property_defs へ改名し target 列を足す）。

CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'DISCONTINUED');
CREATE TYPE "PropertyTarget" AS ENUM ('SUBSTANCE', 'PRODUCT');

-- 1) 項目定義を共有の表にする（既存データはすべて物質のもの）
ALTER TABLE "substance_property_defs" RENAME TO "property_defs";
ALTER TABLE "property_defs" ADD COLUMN "target" "PropertyTarget";
UPDATE "property_defs" SET "target" = 'SUBSTANCE';
ALTER TABLE "property_defs" ALTER COLUMN "target" SET NOT NULL;

-- キーは用途ごとに一意。物質と製品で同じキーを使えるようにする
ALTER TABLE "property_defs" RENAME CONSTRAINT "substance_property_defs_pkey" TO "property_defs_pkey";
DROP INDEX "substance_property_defs_key_key";
CREATE UNIQUE INDEX "property_defs_target_key_key" ON "property_defs"("target", "key");

ALTER TABLE "substance_properties"
  RENAME CONSTRAINT "substance_properties_property_def_id_fkey" TO "substance_properties_def_fkey";

-- 2) 製品
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "name_ja" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500),
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "usable_as_material" BOOLEAN NOT NULL DEFAULT false,
    "private_flag" BOOLEAN NOT NULL DEFAULT false,
    "composition_public_flag" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_code_normalized_key" ON "products"("code_normalized");
CREATE INDEX "products_name_ja_idx" ON "products"("name_ja");
CREATE INDEX "products_name_en_idx" ON "products"("name_en");
CREATE INDEX "products_status_idx" ON "products"("status");
CREATE INDEX "products_usable_as_material_idx" ON "products"("usable_as_material");
CREATE INDEX "products_private_flag_idx" ON "products"("private_flag");

-- コードは空文字を許さない（物質と同じ）
ALTER TABLE "products"
  ADD CONSTRAINT "products_code_not_blank"
  CHECK (length(btrim("code")) > 0 AND length(btrim("code_normalized")) > 0);

-- 3) 別名
CREATE TABLE "product_aliases" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name_ja" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_aliases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_aliases_product_id_idx" ON "product_aliases"("product_id");
CREATE INDEX "product_aliases_name_ja_idx" ON "product_aliases"("name_ja");
CREATE INDEX "product_aliases_name_en_idx" ON "product_aliases"("name_en");

ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) 拡張属性の値（製品）
CREATE TABLE "product_properties" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "property_def_id" TEXT NOT NULL,
    "value_text" TEXT,
    "value_num" DECIMAL(18,6),
    "unit" VARCHAR(50),

    CONSTRAINT "product_properties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_properties_product_id_property_def_id_key"
  ON "product_properties"("product_id", "property_def_id");
CREATE INDEX "product_properties_property_def_id_value_num_idx"
  ON "product_properties"("property_def_id", "value_num");

ALTER TABLE "product_properties" ADD CONSTRAINT "product_properties_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_properties" ADD CONSTRAINT "product_properties_def_fkey"
  FOREIGN KEY ("property_def_id") REFERENCES "property_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 値は数値かテキストのどちらか一方だけ（物質側と同じ CHECK 制約）
ALTER TABLE "product_properties"
  ADD CONSTRAINT "product_properties_value_one_of"
  CHECK (("value_text" IS NOT NULL) <> ("value_num" IS NOT NULL));
