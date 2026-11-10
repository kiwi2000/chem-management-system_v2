-- S31 組織管理: 製品・物質の取り込みで所属先の決め方を選ぶ（画面で選んだ所属先 / TSV の所属先の列）。
-- 読み取りを頼んだ人も残し、その人に見える・直せる範囲で突き合わせる
ALTER TABLE "import_jobs" ADD COLUMN "owner_mode" VARCHAR(10);
ALTER TABLE "import_jobs" ADD COLUMN "owner_group_id" TEXT;
ALTER TABLE "import_jobs" ADD COLUMN "staged_by" TEXT;

-- 帳票に載せた製品・物質（S31 仕様 10 章「ドキュメント」）。見られないものが 1 つでも載っていれば、作った本人も開けない。
-- これより前に作った帳票は空のまま（中身が分からないので、一覧の帳票は作った本人とシステム管理グループだけが開ける）
ALTER TABLE "generated_documents" ADD COLUMN "content_product_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "generated_documents" ADD COLUMN "content_substance_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 法規制の画面に出す物質名のビューに、物質の所属先を足す（S31。見えない物質の名前を出さないため）。
-- 列は最後に足す（CREATE OR REPLACE VIEW は既存の列の並びを変えられない）
CREATE OR REPLACE VIEW "statutory_cas_link_names" AS
SELECT CONCAT(l."id", ':', s."id")  AS "row_key",
       l."id"                       AS "link_id",
       s."id"                       AS "substance_id",
       CAST(NULL AS VARCHAR(64))    AS "alias_id",
       s."name_ja"                  AS "name_ja",
       s."name_en"                  AS "name_en",
       s."is_cas_representative"    AS "is_cas_representative",
       s."publish_state"            AS "publish_state",
       s."created_by"               AS "created_by",
       s."owner_group_id"           AS "owner_group_id"
FROM "statutory_cas_links" l
JOIN "substances" s
  ON s."cas_normalized" = l."cas_normalized"
 AND s."deleted_at" IS NULL
UNION ALL
SELECT CONCAT(l."id", ':', a."id"),
       l."id",
       s."id",
       a."id",
       a."name_ja",
       a."name_en",
       s."is_cas_representative",
       s."publish_state",
       s."created_by",
       s."owner_group_id"
FROM "statutory_cas_links" l
JOIN "substances" s
  ON s."cas_normalized" = l."cas_normalized"
 AND s."deleted_at" IS NULL
JOIN "substance_aliases" a
  ON a."substance_id" = s."id";

CREATE OR REPLACE VIEW "statutory_cas_link_diff_names" AS
SELECT CONCAT(d."id", ':', s."id")  AS "row_key",
       d."id"                       AS "diff_id",
       s."id"                       AS "substance_id",
       CAST(NULL AS VARCHAR(64))    AS "alias_id",
       s."name_ja"                  AS "name_ja",
       s."name_en"                  AS "name_en",
       s."is_cas_representative"    AS "is_cas_representative",
       s."publish_state"            AS "publish_state",
       s."created_by"               AS "created_by",
       s."owner_group_id"           AS "owner_group_id"
FROM "statutory_cas_link_diffs" d
JOIN "substances" s
  ON s."cas_normalized" = d."cas_normalized"
 AND s."deleted_at" IS NULL
UNION ALL
SELECT CONCAT(d."id", ':', a."id"),
       d."id",
       s."id",
       a."id",
       a."name_ja",
       a."name_en",
       s."is_cas_representative",
       s."publish_state",
       s."created_by",
       s."owner_group_id"
FROM "statutory_cas_link_diffs" d
JOIN "substances" s
  ON s."cas_normalized" = d."cas_normalized"
 AND s."deleted_at" IS NULL
JOIN "substance_aliases" a
  ON a."substance_id" = s."id";
