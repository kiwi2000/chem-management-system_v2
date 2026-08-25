-- 2要素認証を「入／切」ではなく「どのやりかたか」で持つ。
--
-- いまは none（使わない）と totp（認証アプリの6桁）の2つ。
-- 将来メール認証を足す可能性があるので、真偽値のままだと足せなくなる。
ALTER TABLE "users" ADD COLUMN "mfa_method" VARCHAR(20) NOT NULL DEFAULT 'none';

-- 既に有効だった人は認証アプリ扱いにする（有効にする手段が無かったので、実際には0件のはず）
UPDATE "users" SET "mfa_method" = 'totp' WHERE "mfa_enabled" = true;

ALTER TABLE "users" DROP COLUMN "mfa_enabled";
