-- 「物質名で探す」を、当たった物質や CAS の一覧を渡し直さずに、条件のまま DB に渡せるようにする
-- （2026-09-18 指摘）。
--
-- 規制対象CAS（リンク）と登録物質は CAS番号の文字列で突き合わせるだけで、表としての関係を
-- 持たない（同じ CAS の物質が複数あってよいので、関係としても張れない）。
-- そこで突き合わせを DB の側で済ませたビューを置き、アプリからはリンクの「名前」として
-- たどれるようにする。1行は「リンク × 物質の名前（主名称または別名）」。主名称の行は alias_id が空。
--
-- 以前はアプリが先に当たる物質（または CAS）を全部取り出して、その一覧を条件に付け直していた。
-- PostgreSQL が1回の問い合わせに受け取れる値は 32,767 個までなので、それを超える名前
-- （たとえば 1 文字）で探すと、問い合わせそのものが失敗していた。

CREATE VIEW "statutory_cas_link_names" AS
SELECT CONCAT(l."id", ':', s."id")  AS "row_key",
       l."id"                       AS "link_id",
       s."id"                       AS "substance_id",
       CAST(NULL AS VARCHAR(64))    AS "alias_id",
       s."name_ja"                  AS "name_ja",
       s."name_en"                  AS "name_en",
       s."is_cas_representative"    AS "is_cas_representative",
       s."publish_state"            AS "publish_state",
       s."created_by"               AS "created_by"
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
       s."created_by"
FROM "statutory_cas_links" l
JOIN "substances" s
  ON s."cas_normalized" = l."cas_normalized"
 AND s."deleted_at" IS NULL
JOIN "substance_aliases" a
  ON a."substance_id" = s."id";

-- 同じものを、差分の行（statutory_cas_link_diffs）に付ける
CREATE VIEW "statutory_cas_link_diff_names" AS
SELECT CONCAT(d."id", ':', s."id")  AS "row_key",
       d."id"                       AS "diff_id",
       s."id"                       AS "substance_id",
       CAST(NULL AS VARCHAR(64))    AS "alias_id",
       s."name_ja"                  AS "name_ja",
       s."name_en"                  AS "name_en",
       s."is_cas_representative"    AS "is_cas_representative",
       s."publish_state"            AS "publish_state",
       s."created_by"               AS "created_by"
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
       s."created_by"
FROM "statutory_cas_link_diffs" d
JOIN "substances" s
  ON s."cas_normalized" = d."cas_normalized"
 AND s."deleted_at" IS NULL
JOIN "substance_aliases" a
  ON a."substance_id" = s."id";
