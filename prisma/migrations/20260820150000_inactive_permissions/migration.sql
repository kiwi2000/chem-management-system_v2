-- 権限の入れ替え。
-- 製品ごとの非公開フラグを廃止したことで PRODUCT_VIEW_PRIVATE / COMPOSITION_VIEW_PRIVATE が
-- 使われなくなったため削除し、代わりに「無効・作成中のデータを扱える」権限を追加する。
-- Postgres の enum は値を削除できないので、新しい型に作り直して差し替える。

-- 使われなくなった権限を、付与済みのユーザーから外す
DELETE FROM "user_permissions"
 WHERE "permission" IN ('PRODUCT_VIEW_PRIVATE', 'COMPOSITION_VIEW_PRIVATE');

CREATE TYPE "Permission_new" AS ENUM (
  'PRODUCT_VIEW',
  'PRODUCT_EDIT',
  'COMPOSITION_VIEW',
  'SUBSTANCE_VIEW',
  'SUBSTANCE_EDIT',
  'INACTIVE_VIEW',
  'INACTIVE_EDIT',
  'REGULATION_VIEW',
  'REGULATION_EDIT',
  'DATA_EXPORT',
  'NEWS_POST',
  'NEWS_MANAGE',
  'ADMIN'
);

ALTER TABLE "user_permissions"
  ALTER COLUMN "permission" TYPE "Permission_new"
  USING ("permission"::text::"Permission_new");

DROP TYPE "Permission";
ALTER TYPE "Permission_new" RENAME TO "Permission";
