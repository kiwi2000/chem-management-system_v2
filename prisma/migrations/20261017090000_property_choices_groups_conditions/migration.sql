-- 拡張属性に「選択肢」の種類・まとまり・システムの項目の印・測定の条件を足す（2026-10-17）
-- 既定の項目は次の移行（20261017090100_property_defaults）で入れる。
-- 足した列挙の値（CHOICE）は、足した移行の中では使えないため分けている

-- CreateEnum
CREATE TYPE "PropertyGroup" AS ENUM ('PHYSICAL', 'HEALTH', 'ENVIRONMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyOptionKind" AS ENUM ('VALUE', 'CONDITION');

-- AlterEnum
ALTER TYPE "PropertyDataType" ADD VALUE 'CHOICE';

-- AlterTable
ALTER TABLE "property_defs" ADD COLUMN     "group" "PropertyGroup" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "system_flag" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable（条件は空なら NULL。値が無い項目は行そのものを作らないので、場所を取らない）
ALTER TABLE "substance_properties" ADD COLUMN     "condition_code" VARCHAR(50),
ADD COLUMN     "condition_text" VARCHAR(200);

ALTER TABLE "product_properties" ADD COLUMN     "condition_code" VARCHAR(50),
ADD COLUMN     "condition_text" VARCHAR(200);

-- CreateTable
CREATE TABLE "property_options" (
    "id" TEXT NOT NULL,
    "property_def_id" TEXT NOT NULL,
    "kind" "PropertyOptionKind" NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "label_ja" VARCHAR(100) NOT NULL,
    "label_en" VARCHAR(100),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "active_flag" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "property_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_options_property_def_id_kind_code_key" ON "property_options"("property_def_id", "kind", "code");

-- AddForeignKey
ALTER TABLE "property_options" ADD CONSTRAINT "property_options_property_def_id_fkey" FOREIGN KEY ("property_def_id") REFERENCES "property_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
