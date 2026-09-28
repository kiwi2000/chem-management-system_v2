-- SDS 作成モジュール: 物質ごとの上書き（自社判定）と、国ごとの出典の採用順（S23 4-9・§5-3、2026-09-28）

-- CreateTable
CREATE TABLE "sds_ghs_overrides" (
    "id" TEXT NOT NULL,
    "substance_id" TEXT NOT NULL,
    "hazard_class" VARCHAR(40) NOT NULL,
    "category" VARCHAR(10) NOT NULL DEFAULT '',
    "status" "SdsGhsClassStatus" NOT NULL,
    "target_organs" VARCHAR(200),
    "h_codes" VARCHAR(60),
    "country" VARCHAR(20) NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL,
    "evidence_ref" VARCHAR(300),
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_required" BOOLEAN NOT NULL DEFAULT false,
    "review_note" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sds_ghs_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_ghs_adoption_rules" (
    "id" TEXT NOT NULL,
    "country" VARCHAR(20) NOT NULL,
    "source_code" VARCHAR(40) NOT NULL,
    "priority" INTEGER NOT NULL,
    "fill_cannot_classify" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sds_ghs_adoption_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sds_ghs_overrides_substance_id_idx" ON "sds_ghs_overrides"("substance_id");

-- CreateIndex
CREATE UNIQUE INDEX "sds_ghs_overrides_substance_id_hazard_class_category_country_key" ON "sds_ghs_overrides"("substance_id", "hazard_class", "category", "country");

-- CreateIndex
CREATE UNIQUE INDEX "sds_ghs_adoption_rules_country_source_code_key" ON "sds_ghs_adoption_rules"("country", "source_code");

-- AddForeignKey
ALTER TABLE "sds_ghs_overrides" ADD CONSTRAINT "sds_ghs_overrides_substance_id_fkey" FOREIGN KEY ("substance_id") REFERENCES "substances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
