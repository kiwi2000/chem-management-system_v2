-- 判定に判定対象日を持たせる（2026-09-22 決定）。
-- 判定はその日に効いている規制で見たものになり、施行前・適用終了の法文物質名・区分は
-- 該当に数えず印を付けて残す。判定を実行した記録を製品ごとに持ち、判定の行を結び付ける。
CREATE TYPE "JudgementEffective" AS ENUM ('IN_FORCE', 'NOT_YET', 'EXPIRED');
CREATE TYPE "JudgementTrigger" AS ENUM ('COMPOSITION', 'MANUAL', 'FULL', 'IMPORT', 'SCRIPT');

-- 判定を実行した記録。行が 0 件の製品（どの法規制にも関わらない）でも「いつ・どの版・どの日付で」が残る
CREATE TABLE "product_judgement_runs" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "judged_as_of" DATE NOT NULL,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trigger" "JudgementTrigger" NOT NULL,
  "actor_id" TEXT,
  "applicable_count" INTEGER NOT NULL DEFAULT 0,
  "review_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "product_judgement_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_judgement_runs_product_id_computed_at_idx"
  ON "product_judgement_runs"("product_id", "computed_at");
ALTER TABLE "product_judgement_runs" ADD CONSTRAINT "product_judgement_runs_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_judgement_runs" ADD CONSTRAINT "product_judgement_runs_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "link_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_judgements"
  ADD COLUMN "judged_as_of" DATE,
  ADD COLUMN "effective" "JudgementEffective" NOT NULL DEFAULT 'IN_FORCE',
  ADD COLUMN "run_id" TEXT;
ALTER TABLE "product_judgements" ADD CONSTRAINT "product_judgements_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "product_judgement_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "product_judgements_effective_idx" ON "product_judgements"("effective");

ALTER TABLE "product_expansions" ADD COLUMN "judged_as_of" DATE;

-- 既存の判定: 計算した日（日本時間）を判定対象日として埋める。
-- 施行前・適用終了の印は付けていない（次の再計算で付く。それまでは「要再計算」の境目判定が拾う）
UPDATE "product_judgements"
  SET "judged_as_of" = ("computed_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date;
ALTER TABLE "product_judgements" ALTER COLUMN "judged_as_of" SET NOT NULL;
UPDATE "product_expansions"
  SET "judged_as_of" = ("judged_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date
  WHERE "judged_at" IS NOT NULL;

-- 既存の判定に実行の記録を 1 件ずつ起こし、その版の行を結び付ける
INSERT INTO "product_judgement_runs"
  ("id", "product_id", "version_id", "judged_as_of", "computed_at", "trigger", "applicable_count", "review_count")
SELECT
  'run_' || md5(e."product_id" || '/' || e."judged_version_id"),
  e."product_id",
  e."judged_version_id",
  e."judged_as_of",
  e."judged_at",
  'FULL',
  (SELECT count(*) FROM "product_judgements" j
     WHERE j."product_id" = e."product_id" AND j."version_id" = e."judged_version_id" AND j."verdict" = 'APPLICABLE'),
  (SELECT count(*) FROM "product_judgements" j
     WHERE j."product_id" = e."product_id" AND j."version_id" = e."judged_version_id" AND j."needs_review")
FROM "product_expansions" e
JOIN "link_set_versions" v ON v."id" = e."judged_version_id"
WHERE e."judged_version_id" IS NOT NULL AND e."judged_at" IS NOT NULL;

UPDATE "product_judgements" j
  SET "run_id" = 'run_' || md5(j."product_id" || '/' || j."version_id")
  FROM "product_expansions" e
  WHERE e."product_id" = j."product_id"
    AND e."judged_version_id" = j."version_id"
    AND e."judged_at" IS NOT NULL;
