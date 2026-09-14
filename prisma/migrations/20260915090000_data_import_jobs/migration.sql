-- 取り込みの一時領域（決定 0011）: import_jobs / import_rows と、権限 DATA_IMPORT。
-- 本体の表には触らない。反映を押すまでの中身はここに置く。
-- （prisma migrate diff の出力から、この変更に関係する文だけを写した。開発DBの索引のずれは含めない）

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('DATA_SET', 'REGULATION_LIST', 'PRODUCTS', 'SUBSTANCES');
-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'LOADING', 'STAGED', 'APPLYING', 'DONE', 'FAILED', 'DISCARDED');
-- CreateEnum
CREATE TYPE "ImportAction" AS ENUM ('ADD', 'UPDATE', 'UNCHANGED', 'CONFLICT', 'ERROR');
-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'DATA_IMPORT';
-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_data" BYTEA,
    "summary" JSONB,
    "error" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "staged_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "applied_by" TEXT,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "key_path" VARCHAR(400) NOT NULL,
    "label" VARCHAR(500) NOT NULL,
    "action" "ImportAction" NOT NULL,
    "apply" BOOLEAN NOT NULL DEFAULT true,
    "diff" JSONB,
    "payload" JSONB NOT NULL,
    "message" VARCHAR(500),

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "import_jobs_status_created_at_idx" ON "import_jobs"("status", "created_at");
-- CreateIndex
CREATE INDEX "import_rows_job_id_kind_action_idx" ON "import_rows"("job_id", "kind", "action");
-- CreateIndex
CREATE UNIQUE INDEX "import_rows_job_id_seq_key" ON "import_rows"("job_id", "seq");
-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
