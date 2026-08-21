-- 利用者ごとのアバター画像。
-- アプリ側のファイルは配置のたびに消えるため、DBに持つ。

ALTER TABLE "users" ADD COLUMN "avatar_data" BYTEA;
ALTER TABLE "users" ADD COLUMN "avatar_mime" VARCHAR(50);
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" TIMESTAMP(3);
