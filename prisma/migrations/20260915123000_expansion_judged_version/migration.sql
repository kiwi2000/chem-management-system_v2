-- 展開結果に「最後に判定した版と時刻」を残す（決定 0012。判定の行が 0 件でも判定済みと分かるように）
ALTER TABLE "product_expansions" ADD COLUMN "judged_version_id" TEXT;
ALTER TABLE "product_expansions" ADD COLUMN "judged_at" TIMESTAMP(3);
