-- 画面の文言はソース内の辞書（packages/shared/src/i18n）で管理する方針に変更した。
-- DB の locales / ui_translations は不要になるため削除し、ユーザーの表示言語は
-- ISO コードの文字列（"ja" / "en"）を直接持つ形にする。docs/decisions/0002 参照。

-- 1) 新しい列を追加し、既存の設定を ISO コードへ移す
ALTER TABLE "users" ADD COLUMN "preferred_locale" TEXT;

UPDATE "users" u
SET "preferred_locale" = l."code"
FROM "locales" l
WHERE u."preferred_locale_id" = l."id";

-- 2) 旧いFKと列を落とす
ALTER TABLE "users" DROP CONSTRAINT "users_preferred_locale_id_fkey";
ALTER TABLE "users" DROP COLUMN "preferred_locale_id";

-- 3) 不要になったテーブルを落とす
ALTER TABLE "ui_translations" DROP CONSTRAINT "ui_translations_locale_id_fkey";
DROP TABLE "ui_translations";
DROP TABLE "locales";
