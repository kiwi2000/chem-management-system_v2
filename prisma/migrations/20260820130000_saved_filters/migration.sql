-- 保存したフィルター条件。一覧のある画面すべてで共通に使う。
CREATE TABLE "saved_filters" (
    "id" TEXT NOT NULL,
    "table_key" VARCHAR(100) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "query" VARCHAR(2000) NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_filters_table_key_owner_id_title_key"
    ON "saved_filters"("table_key", "owner_id", "title");
CREATE INDEX "saved_filters_table_key_shared_idx" ON "saved_filters"("table_key", "shared");

ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
