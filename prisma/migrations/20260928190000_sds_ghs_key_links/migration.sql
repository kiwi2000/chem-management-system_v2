-- SDS 作成モジュール: 出典の項目（識別子）と CAS の結び付き（原典以外の層。LOLI の展開・人の手）。S23 §9-4、2026-09-28
-- 項目の行（版ごと）ではなく識別子に結ぶので、出典を取り込み直して版が増えても結び付きは残る

-- AlterEnum
ALTER TYPE "SdsGhsIssueKind" ADD VALUE 'UNKNOWN_KEY';

-- CreateTable
CREATE TABLE "sds_ghs_key_links" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_key" VARCHAR(60) NOT NULL,
    "cas_normalized" VARCHAR(20) NOT NULL,
    "cas_raw" VARCHAR(30) NOT NULL,
    "origin" "SdsGhsCasOrigin" NOT NULL,
    "linked_by" VARCHAR(40) NOT NULL,
    "release_id" TEXT,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "sds_ghs_key_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sds_ghs_key_links_cas_normalized_idx" ON "sds_ghs_key_links"("cas_normalized");

-- CreateIndex
CREATE INDEX "sds_ghs_key_links_source_id_source_key_idx" ON "sds_ghs_key_links"("source_id", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "sds_ghs_key_links_source_id_source_key_cas_normalized_linke_key" ON "sds_ghs_key_links"("source_id", "source_key", "cas_normalized", "linked_by");

-- AddForeignKey
ALTER TABLE "sds_ghs_key_links" ADD CONSTRAINT "sds_ghs_key_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sds_ghs_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_ghs_key_links" ADD CONSTRAINT "sds_ghs_key_links_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "sds_ghs_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
