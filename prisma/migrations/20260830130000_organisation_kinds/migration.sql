-- 組織に種別を持たせ、部署を組織へまとめる。
--
-- これまで「会社」は組織、「部署」はグループ（種別ORG）と、別々の表に入れていた。
-- どちらも名前と項目を持ち、帳票に差し込む入れもので、作りは変わらない。
-- **1つの表にまとめ、種別で見分ける。**取引先もここへ入る。

-- 1. 種別
DO $$ BEGIN
  CREATE TYPE "OrganisationKind" AS ENUM ('COMPANY', 'DEPARTMENT', 'PARTNER', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "kind" "OrganisationKind" NOT NULL DEFAULT 'COMPANY';
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "kind_label" TEXT;

-- 2. 利用者の部署。組織を指す
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "department_id" TEXT;

-- 3. 部署のグループを、組織（種別=部署）へ移す。
--    コードはグループのIDから作る（組織のコードは一意で、グループは持っていないため）
INSERT INTO "organisations" ("id", "code", "kind", "name_ja", "name_en", "display_order", "active_flag", "created_at", "updated_at", "deleted_at")
SELECT g."id", 'DEP-' || SUBSTRING(g."id" FROM 1 FOR 12), 'DEPARTMENT', g."name_ja", g."name_en",
       g."display_order", g."active_flag", g."created_at", g."updated_at", g."deleted_at"
FROM "groups" AS g
WHERE g."kind" = 'ORG'
  AND NOT EXISTS (SELECT 1 FROM "organisations" AS o WHERE o."id" = g."id");

-- 4. 所属していた人を、新しい部署へつなぎ直す
UPDATE "users" SET "department_id" = "org_group_id" WHERE "org_group_id" IS NOT NULL;

-- 5. 移した部署のグループを消す（お知らせのグループは残す）
DELETE FROM "groups" WHERE "kind" = 'ORG';

-- 6. 古い列を外す
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_org_group_id_fkey";
DROP INDEX IF EXISTS "users_org_group_id_idx";
ALTER TABLE "users" DROP COLUMN IF EXISTS "org_group_id";

ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "users_department_id_idx" ON "users"("department_id");

-- 7. 様式に「宛先を使う」印
ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "uses_recipient" BOOLEAN NOT NULL DEFAULT false;
