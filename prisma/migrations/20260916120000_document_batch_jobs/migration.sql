-- まとめて帳票を作る仕事（バックグラウンド処理。2026-09-16）
CREATE TYPE "DocBatchStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "document_batch_jobs" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "status" "DocBatchStatus" NOT NULL DEFAULT 'QUEUED',
    "selection" JSONB NOT NULL,
    "params" JSONB,
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "missed" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "error" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_batch_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_batch_jobs_created_by_created_at_idx" ON "document_batch_jobs"("created_by", "created_at");
CREATE INDEX "document_batch_jobs_status_idx" ON "document_batch_jobs"("status");

ALTER TABLE "document_batch_jobs" ADD CONSTRAINT "document_batch_jobs_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- まとめて作った帳票は、仕事に結び付けて残す（まとめて開いて 1 回で刷るため）
ALTER TABLE "generated_documents" ADD COLUMN "batch_job_id" TEXT;
CREATE INDEX "generated_documents_batch_job_id_idx" ON "generated_documents"("batch_job_id");
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_batch_job_id_fkey"
  FOREIGN KEY ("batch_job_id") REFERENCES "document_batch_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
