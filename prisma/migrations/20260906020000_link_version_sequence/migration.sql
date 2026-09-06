-- バージョンの新旧を、コードの文字順ではなく「通番」で決める。
--
-- コードは利用者が自由に付ける名前で（2026Q3 でも 2026春 でもよい）、
-- 文字順が時系列と合う保証が無い。並び・現在の自動判定・前のバージョン・差分の相手は
-- すべて通番の降順で決める。既存の行には、これまでの順（コードの文字順）で通番を振る。
ALTER TABLE "link_set_versions" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

UPDATE "link_set_versions" v
   SET "sequence" = n.rn
  FROM (SELECT "id", row_number() OVER (ORDER BY "code_normalized") AS rn
          FROM "link_set_versions") n
 WHERE v."id" = n."id";

CREATE INDEX "link_set_versions_sequence_idx" ON "link_set_versions"("sequence");
