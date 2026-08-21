-- CAS番号ごとの代表物質。
--
-- 同じCAS番号の物質は、仕入先ごとに分けて管理する事情があるため複数登録できる。
-- 一方で法規制の判定はCAS単位で行うので、合算した行に出す名称を1つに決める必要がある。
-- そのための「このCASを代表する物質」を1件だけ立てる。
--
-- 代表が不在のCASを作らないため、制約はDBで持つ（アプリのバグでは壊せないようにする）。
ALTER TABLE "substances"
  ADD COLUMN "is_cas_representative" BOOLEAN NOT NULL DEFAULT false;

-- 生きている物質のうち、1つのCASにつき代表は1件まで。
-- 論理削除済みは数えない（同じコードを再登録できるようにしているのと同じ考え方）。
CREATE UNIQUE INDEX "substances_cas_representative_key"
  ON "substances" ("cas_normalized")
  WHERE "is_cas_representative" AND "deleted_at" IS NULL;

-- すでにあるデータに代表を立てる。
-- 有効なものを優先し、その中でいちばん古いものを選ぶ。
-- 廃番品の名称が合算した行に出続けるのを避けるため（アプリ側の ensureCasRepresentative と同じ決め方）。
-- 有効なものが1つも無いCASでは、いちばん古いものを立てる（代表不在を作らない）。
UPDATE "substances" s
SET "is_cas_representative" = true
WHERE s."cas_normalized" IS NOT NULL
  AND s."deleted_at" IS NULL
  AND s."id" = (
    SELECT t."id" FROM "substances" t
    WHERE t."cas_normalized" = s."cas_normalized" AND t."deleted_at" IS NULL
    ORDER BY (t."status" = 'ACTIVE') DESC, t."created_at" ASC, t."id" ASC
    LIMIT 1
  );
