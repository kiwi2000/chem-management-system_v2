-- 判定結果を法規制バージョンごとに持ち、人の判断を判定の行から切り離す（2026-09-12 決定）。
--
-- これまで判定は「製品 × 規制区分」で1行だけで、判定し直すたびに行ごと作り直していた。
-- 現在のバージョンを切り替えても計算し直されないので、前の版で出した結果が
-- 新しい版の結果のように見える取り違えが起きた。
--
--   1. 判定の行に「どの版か」を必ず持たせ、「製品 × 規制区分 × 版」で1行にする
--   2. 人の確認・上書きは product_decisions に移し、判定し直しても消えないようにする。
--      判断したときのシステムの結果（system_verdict と premise）を控えておき、
--      次に判定し直したときに同じなら当てはめ直す
--
-- 版が空の古い行は、現在のバージョンのものとみなす。現在のバージョンが無ければ消す
-- （判定し直せば作り直せる）。

-- ---- 1. 判定の行：版を必須にし、システムの判定と前提を足す ---------------------------

UPDATE "product_judgements"
SET "version_id" = (
  SELECT "id" FROM "link_set_versions"
  WHERE "is_current" = true AND "deleted_at" IS NULL
  ORDER BY "created_at" DESC
  LIMIT 1
)
WHERE "version_id" IS NULL;

DELETE FROM "product_judgements" WHERE "version_id" IS NULL;

ALTER TABLE "product_judgements"
  ALTER COLUMN "version_id" SET NOT NULL,
  ADD COLUMN "system_verdict" "JudgementVerdict",
  ADD COLUMN "premise" TEXT NOT NULL DEFAULT '';

-- システムの判定は「当たりが1つでもあれば該当」だったので、根拠の行の有無で復元できる。
-- 前提の要約は lib/judge-decision.ts の premiseOf と同じ作りかた
-- （法文物質名:CAS,CAS;… を、バイト順に並べてつなぐ）。
UPDATE "product_judgements" j
SET
  "system_verdict" = CASE
    WHEN EXISTS (SELECT 1 FROM "product_judgement_hits" h WHERE h."judgement_id" = j."id")
      THEN 'APPLICABLE'::"JudgementVerdict"
    ELSE 'NOT_APPLICABLE'::"JudgementVerdict"
  END,
  "premise" = COALESCE((
    SELECT string_agg(s."x", ';' ORDER BY s."x" COLLATE "C")
    FROM (
      SELECT COALESCE(h."statutory_substance_id", '*') || ':' || COALESCE((
        SELECT string_agg(d."v", ',' ORDER BY d."v" COLLATE "C")
        FROM (
          SELECT DISTINCT c->>'cas' AS "v"
          FROM jsonb_array_elements(COALESCE(h."contributions", '[]'::jsonb)) c
        ) d
      ), '') AS "x"
      FROM "product_judgement_hits" h
      WHERE h."judgement_id" = j."id"
    ) s
  ), '');

ALTER TABLE "product_judgements" ALTER COLUMN "system_verdict" SET NOT NULL;

DROP INDEX "product_judgements_product_id_category_id_key";
CREATE UNIQUE INDEX "product_judgements_product_id_category_id_version_id_key"
  ON "product_judgements"("product_id", "category_id", "version_id");
CREATE INDEX "product_judgements_version_id_idx" ON "product_judgements"("version_id");

ALTER TABLE "product_judgements"
  ADD CONSTRAINT "product_judgements_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "link_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- 2. 人の判断：判定の行から別の表へ --------------------------------------------

CREATE TABLE "product_decisions" (
  "id"             TEXT NOT NULL,
  "product_id"     TEXT NOT NULL,
  "category_id"    TEXT NOT NULL,
  "verdict"        "JudgementVerdict",
  "system_verdict" "JudgementVerdict" NOT NULL,
  "premise"        TEXT NOT NULL,
  "decided_by"     TEXT NOT NULL,
  "decided_at"     TIMESTAMP(3) NOT NULL,
  "decided_note"   TEXT,
  CONSTRAINT "product_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_decisions_product_id_category_id_key"
  ON "product_decisions"("product_id", "category_id");

ALTER TABLE "product_decisions"
  ADD CONSTRAINT "product_decisions_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_decisions"
  ADD CONSTRAINT "product_decisions_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "regulation_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- すでに人が確認・上書きしていた判定は、その前提ごと引き継ぐ。
-- 移す前は「製品 × 規制区分」で1行しか無いので、重なることはない
INSERT INTO "product_decisions"
  ("id", "product_id", "category_id", "verdict", "system_verdict", "premise",
   "decided_by", "decided_at", "decided_note")
SELECT
  'pd' || j."id",
  j."product_id",
  j."category_id",
  CASE WHEN j."source" = 'USER' THEN j."verdict" ELSE NULL END,
  j."system_verdict",
  j."premise",
  j."decided_by",
  j."decided_at",
  j."decided_note"
FROM "product_judgements" j
WHERE j."decided_by" IS NOT NULL AND j."decided_at" IS NOT NULL;
