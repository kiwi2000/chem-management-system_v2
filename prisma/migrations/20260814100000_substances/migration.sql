-- CreateEnum
CREATE TYPE "SubstanceStatus" AS ENUM ('ACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "SubstanceNameType" AS ENUM ('MAIN', 'SUB');

-- CreateEnum
CREATE TYPE "GazetteLawKind" AS ENUM ('CSCL', 'ISHA', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyDataType" AS ENUM ('NUMBER', 'TEXT');

-- CreateTable
CREATE TABLE "substances" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "cas_number" VARCHAR(20),
    "cas_normalized" VARCHAR(20),
    "status" "SubstanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "substances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substance_names" (
    "id" TEXT NOT NULL,
    "substance_id" TEXT NOT NULL,
    "name_type" "SubstanceNameType" NOT NULL,
    "name_ja" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500),
    "display_order" INTEGER,

    CONSTRAINT "substance_names_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substance_gazette_numbers" (
    "id" TEXT NOT NULL,
    "substance_id" TEXT NOT NULL,
    "law_kind" "GazetteLawKind" NOT NULL,
    "number" VARCHAR(50) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "substance_gazette_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substance_property_defs" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "label_ja" VARCHAR(100) NOT NULL,
    "label_en" VARCHAR(100),
    "data_type" "PropertyDataType" NOT NULL,
    "default_unit" VARCHAR(50),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "active_flag" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "substance_property_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substance_properties" (
    "id" TEXT NOT NULL,
    "substance_id" TEXT NOT NULL,
    "property_def_id" TEXT NOT NULL,
    "value_text" TEXT,
    "value_num" DECIMAL(18,6),
    "unit" VARCHAR(50),

    CONSTRAINT "substance_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "substances_code_normalized_key" ON "substances"("code_normalized");

-- CreateIndex
CREATE INDEX "substances_cas_normalized_idx" ON "substances"("cas_normalized");

-- CreateIndex
CREATE INDEX "substances_status_idx" ON "substances"("status");

-- CreateIndex
CREATE INDEX "substance_names_substance_id_idx" ON "substance_names"("substance_id");

-- CreateIndex
CREATE INDEX "substance_names_name_ja_idx" ON "substance_names"("name_ja");

-- CreateIndex
CREATE INDEX "substance_names_name_en_idx" ON "substance_names"("name_en");

-- CreateIndex
CREATE INDEX "substance_gazette_numbers_number_idx" ON "substance_gazette_numbers"("number");

-- CreateIndex
CREATE UNIQUE INDEX "substance_gazette_numbers_substance_id_law_kind_number_key" ON "substance_gazette_numbers"("substance_id", "law_kind", "number");

-- CreateIndex
CREATE UNIQUE INDEX "substance_property_defs_key_key" ON "substance_property_defs"("key");

-- CreateIndex
CREATE INDEX "substance_properties_property_def_id_value_num_idx" ON "substance_properties"("property_def_id", "value_num");

-- CreateIndex
CREATE UNIQUE INDEX "substance_properties_substance_id_property_def_id_key" ON "substance_properties"("substance_id", "property_def_id");

-- AddForeignKey
ALTER TABLE "substance_names" ADD CONSTRAINT "substance_names_substance_id_fkey" FOREIGN KEY ("substance_id") REFERENCES "substances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substance_gazette_numbers" ADD CONSTRAINT "substance_gazette_numbers_substance_id_fkey" FOREIGN KEY ("substance_id") REFERENCES "substances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substance_properties" ADD CONSTRAINT "substance_properties_substance_id_fkey" FOREIGN KEY ("substance_id") REFERENCES "substances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substance_properties" ADD CONSTRAINT "substance_properties_property_def_id_fkey" FOREIGN KEY ("property_def_id") REFERENCES "substance_property_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ここから手書き（Prisma が生成できない CHECK 制約）。
-- アプリ層でも同じ検証を行うが、DB側にも置いて最後の砦とする。

-- 拡張属性の値は、数値かテキストのどちらか一方だけを持つ（両方入り・両方空を防ぐ）。
-- 種類（NUMBER / TEXT）との整合は定義を参照する必要があるためアプリ層で担保する。
ALTER TABLE "substance_properties"
  ADD CONSTRAINT "substance_properties_value_one_of"
  CHECK (("value_text" IS NOT NULL) <> ("value_num" IS NOT NULL));

-- コードは空文字を許さない（trim 済みの値が入る前提）
ALTER TABLE "substances"
  ADD CONSTRAINT "substances_code_not_blank"
  CHECK (length(btrim("code")) > 0 AND length(btrim("code_normalized")) > 0);
