-- 法規制のテーブル一式。
-- 階層は 地域 → 法令 → 区分 → 分類 → 法文物質名 → CASリンク。
-- 判定に使う閾値は法文物質名が持ち、版が管理するのは CASリンク だけ。

-- CreateEnum
CREATE TYPE "ThresholdBound" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

-- CreateTable
CREATE TABLE "regions" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "name_ja" VARCHAR(200) NOT NULL,
    "name_en" VARCHAR(200),
    "group" VARCHAR(50),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "laws" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "region_id" TEXT NOT NULL,
    "name_original" VARCHAR(500) NOT NULL,
    "name_lang" VARCHAR(10) NOT NULL,
    "name_ja" VARCHAR(500),
    "name_en" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "laws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulation_categories" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "law_id" TEXT NOT NULL,
    "name_original" VARCHAR(500) NOT NULL,
    "name_lang" VARCHAR(10) NOT NULL,
    "name_ja" VARCHAR(500),
    "name_en" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "threshold_lower" DECIMAL(9,6) NOT NULL,
    "lower_bound" "ThresholdBound" NOT NULL,
    "threshold_upper" DECIMAL(9,6) NOT NULL,
    "upper_bound" "ThresholdBound" NOT NULL,
    "interaction_group" VARCHAR(50),
    "rank" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "regulation_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulation_classes" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "category_id" TEXT NOT NULL,
    "name_original" VARCHAR(500),
    "name_lang" VARCHAR(10),
    "name_ja" VARCHAR(500),
    "name_en" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "interaction_group" VARCHAR(50),
    "rank" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "regulation_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statutory_substances" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "class_id" TEXT NOT NULL,
    "official_number" VARCHAR(50),
    "name_original" VARCHAR(500) NOT NULL,
    "name_lang" VARCHAR(10) NOT NULL,
    "name_ja" VARCHAR(500),
    "name_en" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "threshold_lower" DECIMAL(9,6) NOT NULL,
    "lower_bound" "ThresholdBound" NOT NULL,
    "threshold_upper" DECIMAL(9,6) NOT NULL,
    "upper_bound" "ThresholdBound" NOT NULL,
    "effective_from" DATE,
    "effective_to" DATE,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "statutory_substances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_set_versions" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "name_ja" VARCHAR(200) NOT NULL,
    "name_en" VARCHAR(200),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "loaded_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "link_set_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "name_ja" VARCHAR(200) NOT NULL,
    "name_en" VARCHAR(200),
    "active_flag" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_version_sources" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "link_version_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statutory_cas_links" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "statutory_substance_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "cas_number" VARCHAR(20) NOT NULL,
    "cas_normalized" VARCHAR(20) NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "statutory_cas_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regions_code_normalized_key" ON "regions"("code_normalized");

-- CreateIndex
CREATE INDEX "regions_group_idx" ON "regions"("group");

-- CreateIndex
CREATE UNIQUE INDEX "laws_code_normalized_key" ON "laws"("code_normalized");

-- CreateIndex
CREATE INDEX "laws_region_id_idx" ON "laws"("region_id");

-- CreateIndex
CREATE INDEX "laws_display_order_idx" ON "laws"("display_order");

-- CreateIndex
CREATE INDEX "regulation_categories_law_id_display_order_idx" ON "regulation_categories"("law_id", "display_order");

-- CreateIndex
CREATE INDEX "regulation_categories_interaction_group_rank_idx" ON "regulation_categories"("interaction_group", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "regulation_categories_law_id_code_normalized_key" ON "regulation_categories"("law_id", "code_normalized");

-- CreateIndex
CREATE INDEX "regulation_classes_category_id_display_order_idx" ON "regulation_classes"("category_id", "display_order");

-- CreateIndex
CREATE INDEX "regulation_classes_interaction_group_rank_idx" ON "regulation_classes"("interaction_group", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "regulation_classes_category_id_code_normalized_key" ON "regulation_classes"("category_id", "code_normalized");

-- CreateIndex
CREATE INDEX "statutory_substances_class_id_display_order_idx" ON "statutory_substances"("class_id", "display_order");

-- CreateIndex
CREATE INDEX "statutory_substances_name_ja_idx" ON "statutory_substances"("name_ja");

-- CreateIndex
CREATE INDEX "statutory_substances_name_en_idx" ON "statutory_substances"("name_en");

-- CreateIndex
CREATE UNIQUE INDEX "statutory_substances_class_id_code_normalized_key" ON "statutory_substances"("class_id", "code_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "link_set_versions_code_normalized_key" ON "link_set_versions"("code_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "sources_code_normalized_key" ON "sources"("code_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "link_version_sources_version_id_source_id_key" ON "link_version_sources"("version_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "link_version_sources_version_id_priority_key" ON "link_version_sources"("version_id", "priority");

-- CreateIndex
CREATE INDEX "statutory_cas_links_version_id_cas_normalized_idx" ON "statutory_cas_links"("version_id", "cas_normalized");

-- CreateIndex
CREATE INDEX "statutory_cas_links_statutory_substance_id_idx" ON "statutory_cas_links"("statutory_substance_id");

-- CreateIndex
CREATE UNIQUE INDEX "statutory_cas_links_version_id_statutory_substance_id_cas_n_key" ON "statutory_cas_links"("version_id", "statutory_substance_id", "cas_normalized", "source_id");

-- AddForeignKey
ALTER TABLE "laws" ADD CONSTRAINT "laws_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulation_categories" ADD CONSTRAINT "regulation_categories_law_id_fkey" FOREIGN KEY ("law_id") REFERENCES "laws"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulation_classes" ADD CONSTRAINT "regulation_classes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "regulation_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_substances" ADD CONSTRAINT "statutory_substances_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "regulation_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_version_sources" ADD CONSTRAINT "link_version_sources_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "link_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_version_sources" ADD CONSTRAINT "link_version_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_cas_links" ADD CONSTRAINT "statutory_cas_links_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "link_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_cas_links" ADD CONSTRAINT "statutory_cas_links_statutory_substance_id_fkey" FOREIGN KEY ("statutory_substance_id") REFERENCES "statutory_substances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_cas_links" ADD CONSTRAINT "statutory_cas_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ここから手書き（Prisma が生成できない制約）

-- 「現在版」はシステム全体で1件だけ。消したものは数えない
CREATE UNIQUE INDEX "link_set_versions_current_key"
  ON "link_set_versions" (("is_current"))
  WHERE "is_current" AND "deleted_at" IS NULL;

-- コードは空にしない（他のマスタと同じ約束）
ALTER TABLE "regions" ADD CONSTRAINT "regions_code_not_blank"
  CHECK (length(btrim("code")) > 0 AND length(btrim("code_normalized")) > 0);
ALTER TABLE "laws" ADD CONSTRAINT "laws_code_not_blank"
  CHECK (length(btrim("code")) > 0 AND length(btrim("code_normalized")) > 0);
ALTER TABLE "regulation_categories" ADD CONSTRAINT "regulation_categories_code_not_blank"
  CHECK (length(btrim("code")) > 0 AND length(btrim("code_normalized")) > 0);
ALTER TABLE "regulation_classes" ADD CONSTRAINT "regulation_classes_code_not_blank"
  CHECK (length(btrim("code")) > 0 AND length(btrim("code_normalized")) > 0);
ALTER TABLE "statutory_substances" ADD CONSTRAINT "statutory_substances_code_not_blank"
  CHECK (length(btrim("code")) > 0 AND length(btrim("code_normalized")) > 0);
ALTER TABLE "link_set_versions" ADD CONSTRAINT "link_set_versions_code_not_blank"
  CHECK (length(btrim("code")) > 0 AND length(btrim("code_normalized")) > 0);
ALTER TABLE "sources" ADD CONSTRAINT "sources_code_not_blank"
  CHECK (length(btrim("code")) > 0 AND length(btrim("code_normalized")) > 0);

-- 閾値は 0〜100 の中に収め、下限が上限を超えないようにする
ALTER TABLE "regulation_categories" ADD CONSTRAINT "regulation_categories_threshold_range"
  CHECK ("threshold_lower" >= 0 AND "threshold_upper" <= 100
     AND "threshold_lower" <= "threshold_upper");
ALTER TABLE "statutory_substances" ADD CONSTRAINT "statutory_substances_threshold_range"
  CHECK ("threshold_lower" >= 0 AND "threshold_upper" <= 100
     AND "threshold_lower" <= "threshold_upper");

-- 分類の表示名は「原文と言語がそろっている」か「どちらも空」のどちらか。
-- どちらも空のものが、分けない区分の受け皿になる
ALTER TABLE "regulation_classes" ADD CONSTRAINT "regulation_classes_name_pair"
  CHECK (("name_original" IS NULL) = ("name_lang" IS NULL));

-- 優先度は1から。小さいほど優先する
ALTER TABLE "link_version_sources" ADD CONSTRAINT "link_version_sources_priority_positive"
  CHECK ("priority" >= 1);

-- 適用期間は逆転させない（参考情報だが、入力の取り違えは弾く）
ALTER TABLE "statutory_substances" ADD CONSTRAINT "statutory_substances_effective_order"
  CHECK ("effective_from" IS NULL OR "effective_to" IS NULL
     OR "effective_from" <= "effective_to");
