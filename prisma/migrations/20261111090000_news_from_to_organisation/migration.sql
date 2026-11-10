-- お知らせの「分類」（groups）をやめ、差出元と宛先を組織から選ぶ形にする（2026-11-11 決定）。
--   差出元 … どこからのお知らせか。ホームの見出しはこれで分ける
--   宛先   … だれ宛てか。その組織とその下の人にだけ見える。空は全員宛て

-- 1. 列を足す
ALTER TABLE "news" ADD COLUMN "from_organisation_id" TEXT;
ALTER TABLE "news" ADD COLUMN "to_organisation_id" TEXT;

-- 2. いまあるお知らせの差出元は、投稿した人のいまの組織にする。
--    宛先は空（全員宛て）のまま。これまでどおり全員に見える
UPDATE "news" n
SET "from_organisation_id" = u."organisation_id"
FROM "users" u
WHERE u."id" = n."author_id";

-- 3. 外部キーと索引。組織は印を付けて消すので、行ごと消す動きは止める（消えて全員宛てに広がらないように）
CREATE INDEX "news_from_organisation_id_idx" ON "news"("from_organisation_id");
CREATE INDEX "news_to_organisation_id_idx" ON "news"("to_organisation_id");
ALTER TABLE "news" ADD CONSTRAINT "news_from_organisation_id_fkey"
  FOREIGN KEY ("from_organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "news" ADD CONSTRAINT "news_to_organisation_id_fkey"
  FOREIGN KEY ("to_organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. 分類をやめる
ALTER TABLE "news" DROP CONSTRAINT "news_group_id_fkey";
DROP INDEX "news_group_id_idx";
ALTER TABLE "news" DROP COLUMN "group_id";

ALTER TABLE "users" DROP CONSTRAINT "users_news_group_id_fkey";
DROP INDEX "users_news_group_id_idx";
ALTER TABLE "users" DROP COLUMN "news_group_id";

DROP TABLE "groups";
DROP TYPE "GroupKind";
