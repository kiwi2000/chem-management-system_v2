-- 製品・原材料の添付ファイル（2026-09-27）。中身は DB に置く（バックアップに入り、コンテナを作り直しても消えない）

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('SDS', 'TEST_REPORT', 'SURVEY', 'DRAWING', 'OTHER');

-- CreateTable
CREATE TABLE "product_attachments" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'OTHER',
    "note" TEXT,
    "composition_only" BOOLEAN NOT NULL DEFAULT false,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "product_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_attachments_product_id_created_at_idx" ON "product_attachments"("product_id", "created_at");

-- AddForeignKey
ALTER TABLE "product_attachments" ADD CONSTRAINT "product_attachments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
