-- 役割（SYSTEM_ADMIN / PRIVILEGED / NON_PRIVILEGED＋can_edit）をやめ、
-- 権限そのものをユーザーに持たせる形へ変更する。あわせてお知らせ機能を追加する。
-- docs/decisions/0003 参照。

-- CreateEnum
CREATE TYPE "Permission" AS ENUM (
  'PRODUCT_VIEW', 'PRODUCT_VIEW_PRIVATE', 'PRODUCT_EDIT',
  'COMPOSITION_VIEW', 'COMPOSITION_VIEW_PRIVATE',
  'SUBSTANCE_VIEW', 'SUBSTANCE_EDIT',
  'REGULATION_VIEW', 'REGULATION_EDIT',
  'DATA_EXPORT',
  'NEWS_POST', 'NEWS_MANAGE',
  'ADMIN'
);

CREATE TYPE "NewsStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" TEXT,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id", "permission")
);

ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 既存ユーザーの役割を権限へ移す（列を落とす前に実施すること）
--   SYSTEM_ADMIN … 全権限
--   PRIVILEGED   … 非公開を含む閲覧一式＋出力＋お知らせ投稿（＋can_edit なら編集）
--   NON_PRIVILEGED … 公開分の閲覧のみ（＋can_edit なら編集）
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u."id", p."permission"
FROM "users" u
CROSS JOIN LATERAL (
  SELECT unnest(
    CASE
      WHEN u."role" = 'SYSTEM_ADMIN' THEN ARRAY[
        'PRODUCT_VIEW','PRODUCT_VIEW_PRIVATE','PRODUCT_EDIT',
        'COMPOSITION_VIEW','COMPOSITION_VIEW_PRIVATE',
        'SUBSTANCE_VIEW','SUBSTANCE_EDIT',
        'REGULATION_VIEW','REGULATION_EDIT',
        'DATA_EXPORT','NEWS_POST','NEWS_MANAGE','ADMIN'
      ]::"Permission"[]
      WHEN u."role" = 'PRIVILEGED' THEN ARRAY[
        'PRODUCT_VIEW','PRODUCT_VIEW_PRIVATE',
        'COMPOSITION_VIEW','COMPOSITION_VIEW_PRIVATE',
        'SUBSTANCE_VIEW','REGULATION_VIEW',
        'DATA_EXPORT','NEWS_POST'
      ]::"Permission"[]
      ELSE ARRAY[
        'PRODUCT_VIEW','COMPOSITION_VIEW','SUBSTANCE_VIEW','REGULATION_VIEW'
      ]::"Permission"[]
    END
  ) AS "permission"
) p;

-- 編集可フラグが立っていた人には編集権限も付ける（管理者は上で付与済み）
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u."id", p."permission"
FROM "users" u
CROSS JOIN LATERAL (
  SELECT unnest(ARRAY['PRODUCT_EDIT','SUBSTANCE_EDIT','REGULATION_EDIT']::"Permission"[])
) p("permission")
WHERE u."can_edit" = true AND u."role" <> 'SYSTEM_ADMIN'
ON CONFLICT DO NOTHING;

-- 役割の列を落とす
ALTER TABLE "users" DROP COLUMN "role";
ALTER TABLE "users" DROP COLUMN "can_edit";
DROP TYPE "Role";

-- CreateTable: お知らせ
CREATE TABLE "news" (
    "id" TEXT NOT NULL,
    "title_ja" TEXT NOT NULL,
    "body_ja" TEXT NOT NULL,
    "title_en" TEXT,
    "body_en" TEXT,
    "status" "NewsStatus" NOT NULL DEFAULT 'DRAFT',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publish_from" TIMESTAMP(3),
    "publish_until" TIMESTAMP(3),
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "news_status_pinned_publish_from_idx" ON "news"("status", "pinned", "publish_from");
CREATE INDEX "news_author_id_idx" ON "news"("author_id");

ALTER TABLE "news" ADD CONSTRAINT "news_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
