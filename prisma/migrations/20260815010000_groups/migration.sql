-- グループ（お知らせの分類 / 組織の所属）
CREATE TYPE "GroupKind" AS ENUM ('NEWS', 'ORG');

CREATE TABLE "groups" (
  "id"            TEXT NOT NULL,
  "kind"          "GroupKind" NOT NULL,
  "name_ja"       TEXT NOT NULL,
  "name_en"       TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "active_flag"   BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3),

  CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "groups_kind_display_order_idx" ON "groups"("kind", "display_order");

-- 所属は1人1つずつ
ALTER TABLE "users" ADD COLUMN "org_group_id"  TEXT;
ALTER TABLE "users" ADD COLUMN "news_group_id" TEXT;

CREATE INDEX "users_org_group_id_idx"  ON "users"("org_group_id");
CREATE INDEX "users_news_group_id_idx" ON "users"("news_group_id");

ALTER TABLE "users" ADD CONSTRAINT "users_org_group_id_fkey"
  FOREIGN KEY ("org_group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_news_group_id_fkey"
  FOREIGN KEY ("news_group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- お知らせは投稿時の分類を写し取って持つ（投稿者の異動で過去の投稿が動かないように）
ALTER TABLE "news" ADD COLUMN "group_id" TEXT;

CREATE INDEX "news_group_id_idx" ON "news"("group_id");

ALTER TABLE "news" ADD CONSTRAINT "news_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
