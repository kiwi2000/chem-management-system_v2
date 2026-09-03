-- ユーザーと組織の結び付きを、多対多にする。
--
-- これまでは「会社1つ（organisation_id）・部署1つ（department_id）」の2枠だった。
-- **種別を問わず何件でも割り当てられる**ようにする。
-- 帳票の差出人には種別「会社」の先頭、お知らせの所属には「部署」の先頭を使う。
CREATE TABLE "user_organisations" (
  "user_id"         TEXT NOT NULL,
  "organisation_id" TEXT NOT NULL,
  CONSTRAINT "user_organisations_pkey" PRIMARY KEY ("user_id", "organisation_id")
);

CREATE INDEX "user_organisations_organisation_id_idx" ON "user_organisations"("organisation_id");

ALTER TABLE "user_organisations"
  ADD CONSTRAINT "user_organisations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_organisations"
  ADD CONSTRAINT "user_organisations_organisation_id_fkey"
  FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- いま割り当たっている会社と部署を、そのまま移す（同じ組織を両方に入れていた人は1件にまとまる）
INSERT INTO "user_organisations" ("user_id", "organisation_id")
SELECT "id", "organisation_id" FROM "users" WHERE "organisation_id" IS NOT NULL
UNION
SELECT "id", "department_id" FROM "users" WHERE "department_id" IS NOT NULL;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_organisation_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_department_id_fkey";
DROP INDEX IF EXISTS "users_organisation_id_idx";
DROP INDEX IF EXISTS "users_department_id_idx";
ALTER TABLE "users"
  DROP COLUMN "organisation_id",
  DROP COLUMN "department_id";
