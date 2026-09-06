-- 外部データベースの「対象CAS」の表で、2つのバージョンの差分（同じデータソースどうし）を見る。
--
-- 差分は「法文物質名 × CAS」で突き合わせて、増えた・消えた・変わった の3種類。
-- 20万行どうしの突き合わせを見るたびにやると重いので、結果を表に置き、
-- リンクが変わっていなければ前回の結果をそのまま使う（run の computed_at で見る）。

CREATE TYPE "LinkDiffKind" AS ENUM ('ADDED', 'REMOVED', 'CHANGED');

CREATE TABLE "statutory_cas_link_diffs" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "against_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "statutory_substance_id" TEXT NOT NULL,
    "cas_normalized" VARCHAR(20) NOT NULL,
    "kind" "LinkDiffKind" NOT NULL,
    "current_link_id" TEXT,
    "previous_link_id" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statutory_cas_link_diffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "statutory_cas_link_diffs_version_id_against_id_source_id_key"
    ON "statutory_cas_link_diffs"("version_id", "against_id", "source_id", "statutory_substance_id", "cas_normalized");
CREATE INDEX "statutory_cas_link_diffs_version_id_against_id_source_id_kind_idx"
    ON "statutory_cas_link_diffs"("version_id", "against_id", "source_id", "kind");

ALTER TABLE "statutory_cas_link_diffs" ADD CONSTRAINT "statutory_cas_link_diffs_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "link_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statutory_cas_link_diffs" ADD CONSTRAINT "statutory_cas_link_diffs_against_id_fkey"
    FOREIGN KEY ("against_id") REFERENCES "link_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statutory_cas_link_diffs" ADD CONSTRAINT "statutory_cas_link_diffs_statutory_substance_id_fkey"
    FOREIGN KEY ("statutory_substance_id") REFERENCES "statutory_substances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statutory_cas_link_diffs" ADD CONSTRAINT "statutory_cas_link_diffs_current_link_id_fkey"
    FOREIGN KEY ("current_link_id") REFERENCES "statutory_cas_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statutory_cas_link_diffs" ADD CONSTRAINT "statutory_cas_link_diffs_previous_link_id_fkey"
    FOREIGN KEY ("previous_link_id") REFERENCES "statutory_cas_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "statutory_cas_link_diff_runs" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "against_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added" INTEGER NOT NULL,
    "removed" INTEGER NOT NULL,
    "changed" INTEGER NOT NULL,

    CONSTRAINT "statutory_cas_link_diff_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "statutory_cas_link_diff_runs_version_id_against_id_source_id_key"
    ON "statutory_cas_link_diff_runs"("version_id", "against_id", "source_id");

ALTER TABLE "statutory_cas_link_diff_runs" ADD CONSTRAINT "statutory_cas_link_diff_runs_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "link_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statutory_cas_link_diff_runs" ADD CONSTRAINT "statutory_cas_link_diff_runs_against_id_fkey"
    FOREIGN KEY ("against_id") REFERENCES "link_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
