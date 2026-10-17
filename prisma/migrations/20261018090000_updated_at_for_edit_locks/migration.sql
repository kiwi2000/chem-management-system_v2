-- 楽観的ロック（lib/edit-stamp.ts）の印に使う更新時刻を、持っていなかった 2 つの表に足す（2026-10-18）。
-- 既存の行は「いま」を入れる（印はこの後の保存から効く）
ALTER TABLE "product_decisions" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sds_ghs_adoption_rules" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
