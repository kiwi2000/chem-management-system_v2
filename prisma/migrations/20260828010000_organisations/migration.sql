-- 組織（会社・事業所）と、その自由項目。
-- 帳票に載せる差出人の情報を置く。項目名も値も打ってもらうので、列は決めない。

CREATE TABLE "organisations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_ja" TEXT NOT NULL,
    "name_en" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "active_flag" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organisations_code_key" ON "organisations"("code");
CREATE INDEX "organisations_display_order_idx" ON "organisations"("display_order");

CREATE TABLE "organisation_items" (
    "id" TEXT NOT NULL,
    "organisation_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organisation_items_pkey" PRIMARY KEY ("id")
);

-- 帳票は項目名で引く。同じ組織の中で重なると、どちらが出るか決まらない
CREATE UNIQUE INDEX "organisation_items_organisation_id_label_key" ON "organisation_items"("organisation_id", "label");
CREATE INDEX "organisation_items_organisation_id_display_order_idx" ON "organisation_items"("organisation_id", "display_order");

ALTER TABLE "organisation_items" ADD CONSTRAINT "organisation_items_organisation_id_fkey"
    FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 所属する会社。所属（部署）とは別に持つ
ALTER TABLE "users" ADD COLUMN "organisation_id" TEXT;
CREATE INDEX "users_organisation_id_idx" ON "users"("organisation_id");
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_fkey"
    FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
