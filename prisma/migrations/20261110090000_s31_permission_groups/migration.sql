-- S31 組織管理: 人ごとの権限と複数の組織を、権限グループと 1 つの組織に置き換える。
-- 仕様は docs/steps/S31_組織管理_仕様案.md の 12 章「今のデータとユーザーの移し方」。
-- 移す処理は DB の中身を見て権限グループを作る（環境ごとに手で作らない）。空の DB でも通ること。

-- ── 新しい表 ─────────────────────────────────────────

CREATE TYPE "PermissionGroupJoinReason" AS ENUM ('DEFAULT', 'MANUAL', 'MIGRATED');

CREATE TABLE "permission_groups" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name_ja" TEXT NOT NULL,
    "name_en" TEXT,
    "is_system_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "permission_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permission_groups_code_key" ON "permission_groups"("code");

CREATE TABLE "permission_group_rows" (
    "group_id" TEXT NOT NULL,
    "target_group_id" TEXT NOT NULL,
    "product_view" BOOLEAN NOT NULL DEFAULT false,
    "product_edit" BOOLEAN NOT NULL DEFAULT false,
    "composition_view" BOOLEAN NOT NULL DEFAULT false,
    "composition_edit" BOOLEAN NOT NULL DEFAULT false,
    "substance_view" BOOLEAN NOT NULL DEFAULT false,
    "substance_edit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permission_group_rows_pkey" PRIMARY KEY ("group_id","target_group_id")
);
CREATE INDEX "permission_group_rows_target_group_id_idx" ON "permission_group_rows"("target_group_id");

CREATE TABLE "permission_group_permissions" (
    "group_id" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,

    CONSTRAINT "permission_group_permissions_pkey" PRIMARY KEY ("group_id","permission")
);

CREATE TABLE "user_permission_groups" (
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "reason" "PermissionGroupJoinReason" NOT NULL DEFAULT 'MANUAL',
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" TEXT,

    CONSTRAINT "user_permission_groups_pkey" PRIMARY KEY ("user_id","group_id")
);
CREATE INDEX "user_permission_groups_group_id_idx" ON "user_permission_groups"("group_id");

CREATE TABLE "organisation_default_groups" (
    "organisation_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,

    CONSTRAINT "organisation_default_groups_pkey" PRIMARY KEY ("organisation_id","group_id")
);
CREATE INDEX "organisation_default_groups_group_id_idx" ON "organisation_default_groups"("group_id");

ALTER TABLE "organisations" ADD COLUMN "parent_id" TEXT;
CREATE INDEX "organisations_parent_id_idx" ON "organisations"("parent_id");
ALTER TABLE "users" ADD COLUMN "organisation_id" TEXT;
CREATE INDEX "users_organisation_id_idx" ON "users"("organisation_id");
-- 所属先は、いったん空を許して入れてから必須にする
ALTER TABLE "products" ADD COLUMN "owner_group_id" TEXT;
ALTER TABLE "substances" ADD COLUMN "owner_group_id" TEXT;

-- ── 最初からある権限グループ ─────────────────────────

-- システム管理グループ（消せない・名前を変えられない。表を持たない）
INSERT INTO "permission_groups" ("id", "code", "name_ja", "name_en", "is_system_admin", "updated_at")
VALUES (replace(gen_random_uuid()::text, '-', ''), 'SYSADMIN', 'システム管理グループ', 'System administrators', true, now());

-- 「全体」。今ある製品・原材料・物質を全部ここに所属させる
INSERT INTO "permission_groups" ("id", "code", "name_ja", "name_en", "is_system_admin", "updated_at")
VALUES (replace(gen_random_uuid()::text, '-', ''), 'ALL', '全体', 'All', false, now());

UPDATE "products" SET "owner_group_id" = (SELECT "id" FROM "permission_groups" WHERE "code" = 'ALL');
UPDATE "substances" SET "owner_group_id" = (SELECT "id" FROM "permission_groups" WHERE "code" = 'ALL');

ALTER TABLE "products" ALTER COLUMN "owner_group_id" SET NOT NULL;
ALTER TABLE "substances" ALTER COLUMN "owner_group_id" SET NOT NULL;
CREATE INDEX "products_owner_group_id_idx" ON "products"("owner_group_id");
CREATE INDEX "substances_owner_group_id_idx" ON "substances"("owner_group_id");

-- ── 人の権限を権限グループへ ─────────────────────────

-- 今のシステム管理者（ADMIN を持つ人）はシステム管理グループへ。何でもできるので、ほかには入れない
INSERT INTO "user_permission_groups" ("user_id", "group_id", "reason")
SELECT DISTINCT up."user_id", g."id", 'MIGRATED'::"PermissionGroupJoinReason"
FROM "user_permissions" up
JOIN "users" u ON u."id" = up."user_id" AND u."deleted_at" IS NULL
CROSS JOIN "permission_groups" g
WHERE up."permission" = 'ADMIN' AND g."is_system_admin";

-- 管理者でない人の権限の組み合わせ。使わなくなった値（無効・未公開を見る／直す、送り主）は落とす
CREATE TEMP TABLE "_s31_sets" ON COMMIT DROP AS
SELECT u."id" AS "user_id",
       u."created_at",
       ',' || string_agg(up."permission"::text, ',' ORDER BY up."permission"::text) || ',' AS "perms"
FROM "users" u
JOIN "user_permissions" up ON up."user_id" = u."id"
WHERE u."deleted_at" IS NULL
  AND up."permission"::text NOT IN ('INACTIVE_VIEW', 'INACTIVE_EDIT', 'DOCUMENT_SENDER')
  AND NOT EXISTS (
    SELECT 1 FROM "user_permissions" a WHERE a."user_id" = u."id" AND a."permission" = 'ADMIN'
  )
GROUP BY u."id", u."created_at";

-- 同じ組み合わせの人どうしを 1 つの「移行 N」にまとめる。番号は、その組み合わせの人がいちばん早く登録された順
CREATE TEMP TABLE "_s31_groups" ON COMMIT DROP AS
SELECT "perms",
       row_number() OVER (ORDER BY min("created_at"), "perms") AS "n",
       replace(gen_random_uuid()::text, '-', '') AS "group_id"
FROM "_s31_sets"
GROUP BY "perms";

INSERT INTO "permission_groups" ("id", "code", "name_ja", "name_en", "is_system_admin", "updated_at")
SELECT "group_id", 'MIG' || "n", '移行 ' || "n", 'Migrated ' || "n", false, now()
FROM "_s31_groups";

-- 表の「全体」の行に、今と同じことができる印を付ける（12 章）
--   製品を直せる → 製品・原材料 編集 と 組成 編集（今の「製品を直せる」は組成を直すことも含むため）
--   組成を見られる → 物質 参照 も付ける（付けないと条件 3 で組成が見えなくなるため）
--   組成 参照は製品・原材料 参照に連動するので、製品を見られない人には付けない（できることを広げない）
INSERT INTO "permission_group_rows" (
  "group_id", "target_group_id",
  "product_view", "product_edit", "composition_view", "composition_edit", "substance_view", "substance_edit"
)
SELECT x."group_id", a."id",
       x."pv", x."pe", x."cv", x."ce", x."sv" OR x."cv", x."se"
FROM (
  SELECT "group_id",
         position(',PRODUCT_VIEW,' IN "perms") > 0 AS "pv",
         position(',PRODUCT_EDIT,' IN "perms") > 0 AS "pe",
         position(',COMPOSITION_VIEW,' IN "perms") > 0 AND position(',PRODUCT_VIEW,' IN "perms") > 0 AS "cv",
         position(',PRODUCT_EDIT,' IN "perms") > 0 AS "ce",
         position(',SUBSTANCE_VIEW,' IN "perms") > 0 AS "sv",
         position(',SUBSTANCE_EDIT,' IN "perms") > 0 AS "se"
  FROM "_s31_groups"
) x
CROSS JOIN "permission_groups" a
WHERE a."code" = 'ALL' AND (x."pv" OR x."pe" OR x."cv" OR x."sv" OR x."se");

-- 表とは別の権限（製品・組成・物質と管理者の権限を除いたもの）
INSERT INTO "permission_group_permissions" ("group_id", "permission")
SELECT g."group_id", p."permission"::"Permission"
FROM "_s31_groups" g
CROSS JOIN unnest(ARRAY[
  'APPROVE', 'REGULATION_VIEW', 'REGULATION_EDIT', 'DATA_EXPORT', 'DATA_IMPORT',
  'DOC_TEMPLATE_EDIT', 'DOCUMENT_CREATE', 'DOCUMENT_DOWNLOAD', 'DOCUMENT_VIEW_ALL', 'ORG_EDIT',
  'NEWS_POST', 'NEWS_MANAGE', 'FEEDBACK_VIEW', 'FEEDBACK_EDIT', 'PRTR_ENTRY'
]) AS p("permission")
WHERE position(',' || p."permission" || ',' IN g."perms") > 0;

INSERT INTO "user_permission_groups" ("user_id", "group_id", "reason")
SELECT s."user_id", g."group_id", 'MIGRATED'::"PermissionGroupJoinReason"
FROM "_s31_sets" s
JOIN "_s31_groups" g ON g."perms" = s."perms";

-- ── 人の組織を 1 つに ────────────────────────────────

-- 2 つ以上に所属していた人は、組織の表示順がいちばん前のもの（同じならコード順）だけを残す。
-- 所属の無かった人は空のまま（あとで管理者が付ける）
UPDATE "users" u
SET "organisation_id" = (
  SELECT uo."organisation_id"
  FROM "user_organisations" uo
  JOIN "organisations" o ON o."id" = uo."organisation_id" AND o."deleted_at" IS NULL
  WHERE uo."user_id" = u."id"
  ORDER BY o."display_order", o."code"
  LIMIT 1
);

-- ── 古い表を消す ─────────────────────────────────────

DROP TABLE "user_organisations";
DROP TABLE "user_permissions";

-- ── 外部キー ─────────────────────────────────────────

ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organisation_default_groups" ADD CONSTRAINT "organisation_default_groups_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organisation_default_groups" ADD CONSTRAINT "organisation_default_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "permission_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "permission_group_rows" ADD CONSTRAINT "permission_group_rows_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "permission_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "permission_group_rows" ADD CONSTRAINT "permission_group_rows_target_group_id_fkey" FOREIGN KEY ("target_group_id") REFERENCES "permission_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "permission_group_permissions" ADD CONSTRAINT "permission_group_permissions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "permission_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permission_groups" ADD CONSTRAINT "user_permission_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permission_groups" ADD CONSTRAINT "user_permission_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "permission_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "substances" ADD CONSTRAINT "substances_owner_group_id_fkey" FOREIGN KEY ("owner_group_id") REFERENCES "permission_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_owner_group_id_fkey" FOREIGN KEY ("owner_group_id") REFERENCES "permission_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
