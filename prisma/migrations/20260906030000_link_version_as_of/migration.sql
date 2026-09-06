-- バージョンの新旧を「通番」ではなく「基準日」（そのデータが何時点のものか）で決める。
--
-- 通番は見ただけでは新旧が分からなかった。日付なら「2026-07-01 のデータ」と読めて自明。
-- 既存の版は、コードが 2026Q3 の形なら四半期の初日、それ以外は登録日を入れておく（画面で直せる）。
ALTER TABLE "link_set_versions" ADD COLUMN "as_of" DATE NOT NULL DEFAULT CURRENT_DATE;

UPDATE "link_set_versions"
   SET "as_of" = CASE
       WHEN "code" ~ '^[0-9]{4}Q[1-4]$'
         THEN make_date(substring("code" from 1 for 4)::int,
                        (substring("code" from 6 for 1)::int - 1) * 3 + 1, 1)
       ELSE "created_at"::date
     END;

ALTER TABLE "link_set_versions" ALTER COLUMN "as_of" DROP DEFAULT;

CREATE INDEX "link_set_versions_as_of_idx" ON "link_set_versions"("as_of");

DROP INDEX IF EXISTS "link_set_versions_sequence_idx";
ALTER TABLE "link_set_versions" DROP COLUMN "sequence";
