-- SDS 作成モジュール: 物質の GHS 分類データ（S23 段 0、2026-09-28）。
-- 出どころ・公表（取り込みの記録）・項目・CAS の突き合わせ・分類・カタログ・表記揺れの辞書・要確認。
-- 本体（SDS なし版）でも表はできるが、使うのはモジュールだけ（決定 0016）

-- CreateEnum
CREATE TYPE "SdsGhsProvider" AS ENUM ('PUBLIC', 'LOLI', 'CHRIP', 'OWN');

-- CreateEnum
CREATE TYPE "SdsGhsDelivery" AS ENUM ('FULL', 'DELTA');

-- CreateEnum
CREATE TYPE "SdsGhsLegalStatus" AS ENUM ('BINDING', 'REFERENCE');

-- CreateEnum
CREATE TYPE "SdsGhsIdentifierKind" AS ENUM ('CAS', 'INDEX_NO', 'OWN_ID');

-- CreateEnum
CREATE TYPE "SdsGhsClassStatus" AS ENUM ('CLASSIFIED', 'NOT_CLASSIFIED', 'CANNOT_CLASSIFY', 'NOT_APPLICABLE', 'NOT_EVALUATED');

-- CreateEnum
CREATE TYPE "SdsGhsHCodesOrigin" AS ENUM ('SOURCE', 'CATALOG');

-- CreateEnum
CREATE TYPE "SdsGhsCasOrigin" AS ENUM ('SOURCE', 'EXPANSION', 'MANUAL');

-- CreateEnum
CREATE TYPE "SdsGhsIssueKind" AS ENUM ('UNKNOWN_TERM', 'PARSE_FAILED', 'CONFLICT', 'DISAPPEARED', 'DUPLICATE_CAS', 'INVALID_CAS');

-- CreateEnum
CREATE TYPE "SdsGhsAliasKind" AS ENUM ('CLASS', 'CATEGORY', 'STATUS', 'NOTE');

-- CreateTable
CREATE TABLE "sds_ghs_sources" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name_ja" VARCHAR(200) NOT NULL,
    "name_en" VARCHAR(200) NOT NULL,
    "country" VARCHAR(20) NOT NULL,
    "provider" "SdsGhsProvider" NOT NULL,
    "delivery" "SdsGhsDelivery" NOT NULL,
    "legal_status" "SdsGhsLegalStatus" NOT NULL,
    "identifier_kind" "SdsGhsIdentifierKind" NOT NULL,
    "covers_all_classes" BOOLEAN NOT NULL,
    "default_ghs_revision" VARCHAR(10),
    "license_note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sds_ghs_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_ghs_releases" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "published_on" DATE NOT NULL,
    "legal_from" DATE,
    "ghs_revision" VARCHAR(10),
    "file_name" VARCHAR(255),
    "file_sha256" VARCHAR(64),
    "source_url" VARCHAR(500),
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by" TEXT,
    "added_count" INTEGER NOT NULL DEFAULT 0,
    "changed_count" INTEGER NOT NULL DEFAULT 0,
    "unchanged_count" INTEGER NOT NULL DEFAULT 0,
    "closed_count" INTEGER NOT NULL DEFAULT 0,
    "issue_count" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "sds_ghs_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_ghs_entries" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_key" VARCHAR(60) NOT NULL,
    "sub_key" VARCHAR(20) NOT NULL DEFAULT '',
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500),
    "ec_number" VARCHAR(20),
    "condition_text" VARCHAR(200),
    "condition_min_pct" DECIMAL(7,3),
    "condition_max_pct" DECIMAL(7,3),
    "physical_form" VARCHAR(40),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "release_in_id" TEXT NOT NULL,
    "release_last_seen_id" TEXT NOT NULL,
    "amending_act" VARCHAR(40),
    "notes_raw" VARCHAR(200),
    "notes" VARCHAR(100),
    "labelling_raw" TEXT,
    "raw_row" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,

    CONSTRAINT "sds_ghs_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_ghs_entry_cas" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "cas_normalized" VARCHAR(20) NOT NULL,
    "cas_raw" VARCHAR(30) NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 1,
    "ec_number" VARCHAR(20),
    "origin" "SdsGhsCasOrigin" NOT NULL DEFAULT 'SOURCE',

    CONSTRAINT "sds_ghs_entry_cas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_ghs_classifications" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "hazard_class" VARCHAR(40) NOT NULL,
    "category" VARCHAR(10) NOT NULL DEFAULT '',
    "status" "SdsGhsClassStatus" NOT NULL,
    "target_organs" VARCHAR(200),
    "h_codes" VARCHAR(60),
    "h_codes_origin" "SdsGhsHCodesOrigin",
    "minimum_classification" VARCHAR(3),
    "ghs_revision" VARCHAR(10),
    "classified_in" VARCHAR(40),
    "rationale" TEXT,
    "raw_class_text" VARCHAR(200) NOT NULL,
    "raw_h_text" VARCHAR(100),

    CONSTRAINT "sds_ghs_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_ghs_hazard_catalog" (
    "id" TEXT NOT NULL,
    "hazard_class" VARCHAR(40) NOT NULL,
    "category" VARCHAR(10) NOT NULL DEFAULT '',
    "h_codes" VARCHAR(60),
    "abbrev_en" VARCHAR(60),
    "name_ja" VARCHAR(120) NOT NULL,
    "name_en" VARCHAR(120) NOT NULL,
    "ghs_revision_from" VARCHAR(10),
    "ghs_revision_to" VARCHAR(10),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sds_ghs_hazard_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_ghs_term_aliases" (
    "id" TEXT NOT NULL,
    "source_code" VARCHAR(40) NOT NULL DEFAULT '',
    "kind" "SdsGhsAliasKind" NOT NULL,
    "raw" VARCHAR(200) NOT NULL,
    "canonical" VARCHAR(200) NOT NULL,
    "note" VARCHAR(200),

    CONSTRAINT "sds_ghs_term_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_ghs_import_issues" (
    "id" TEXT NOT NULL,
    "release_id" TEXT NOT NULL,
    "entry_id" TEXT,
    "kind" "SdsGhsIssueKind" NOT NULL,
    "detail" TEXT NOT NULL,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution" VARCHAR(200),

    CONSTRAINT "sds_ghs_import_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sds_ghs_sources_code_key" ON "sds_ghs_sources"("code");

-- CreateIndex
CREATE INDEX "sds_ghs_releases_source_id_published_on_idx" ON "sds_ghs_releases"("source_id", "published_on");

-- CreateIndex
CREATE INDEX "sds_ghs_entries_source_id_effective_to_idx" ON "sds_ghs_entries"("source_id", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "sds_ghs_entries_source_id_source_key_sub_key_effective_from_key" ON "sds_ghs_entries"("source_id", "source_key", "sub_key", "effective_from");

-- CreateIndex
CREATE INDEX "sds_ghs_entry_cas_cas_normalized_idx" ON "sds_ghs_entry_cas"("cas_normalized");

-- CreateIndex
CREATE INDEX "sds_ghs_entry_cas_entry_id_idx" ON "sds_ghs_entry_cas"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "sds_ghs_classifications_entry_id_hazard_class_category_key" ON "sds_ghs_classifications"("entry_id", "hazard_class", "category");

-- CreateIndex
CREATE UNIQUE INDEX "sds_ghs_hazard_catalog_hazard_class_category_key" ON "sds_ghs_hazard_catalog"("hazard_class", "category");

-- CreateIndex
CREATE UNIQUE INDEX "sds_ghs_term_aliases_source_code_kind_raw_key" ON "sds_ghs_term_aliases"("source_code", "kind", "raw");

-- CreateIndex
CREATE INDEX "sds_ghs_import_issues_release_id_idx" ON "sds_ghs_import_issues"("release_id");

-- AddForeignKey
ALTER TABLE "sds_ghs_releases" ADD CONSTRAINT "sds_ghs_releases_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sds_ghs_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_ghs_entries" ADD CONSTRAINT "sds_ghs_entries_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sds_ghs_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_ghs_entries" ADD CONSTRAINT "sds_ghs_entries_release_in_id_fkey" FOREIGN KEY ("release_in_id") REFERENCES "sds_ghs_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_ghs_entries" ADD CONSTRAINT "sds_ghs_entries_release_last_seen_id_fkey" FOREIGN KEY ("release_last_seen_id") REFERENCES "sds_ghs_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_ghs_entry_cas" ADD CONSTRAINT "sds_ghs_entry_cas_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "sds_ghs_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_ghs_classifications" ADD CONSTRAINT "sds_ghs_classifications_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "sds_ghs_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_ghs_import_issues" ADD CONSTRAINT "sds_ghs_import_issues_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "sds_ghs_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_ghs_import_issues" ADD CONSTRAINT "sds_ghs_import_issues_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "sds_ghs_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
