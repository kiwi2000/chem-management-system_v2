-- 「不純物パターン」→「不純物種別」（2026-09-19 指示）。
--
-- 画面の呼び名を変えたので、表・列・索引・制約の名前も pattern → type に揃える。
-- **作り直さずに名前だけ変える。**本番・評価機・手元のどれにも設定済みのデータがあり、
-- DROP / CREATE にすると消えるため。
--
-- 組み込みの id（`ip-none` / `ip-impurity`）は変えない。
-- `product_expansion_lines` はこの表への外部キーを持たない（既定値で入れている）ので、
-- id を変えると取り残しが出る。

-- 種別の表そのもの
ALTER TABLE "impurity_patterns" RENAME TO "impurity_types";
ALTER TABLE "impurity_types" RENAME CONSTRAINT "impurity_patterns_pkey" TO "impurity_types_pkey";
ALTER INDEX "impurity_patterns_code_normalized_key" RENAME TO "impurity_types_code_normalized_key";

-- 物質が持つ種別
ALTER TABLE "substances" RENAME COLUMN "impurity_pattern_id" TO "impurity_type_id";
ALTER TABLE "substances"
  RENAME CONSTRAINT "substances_impurity_pattern_id_fkey" TO "substances_impurity_type_id_fkey";
ALTER INDEX "substances_impurity_pattern_id_idx" RENAME TO "substances_impurity_type_id_idx";
-- 代表物質の部分索引（`substances_cas_representative_key`）は名前に pattern を含まないので
-- そのまま。列名の変更は索引の定義にも自動で効く

-- 展開結果の行
ALTER TABLE "product_expansion_lines" RENAME COLUMN "impurity_pattern_id" TO "impurity_type_id";
ALTER INDEX "product_expansion_lines_key_cas_pattern" RENAME TO "product_expansion_lines_key_cas_type";

-- 除外：種別 × 規制区分
ALTER TABLE "impurity_exemptions" RENAME COLUMN "pattern_id" TO "type_id";
ALTER TABLE "impurity_exemptions"
  RENAME CONSTRAINT "impurity_exemptions_pattern_id_fkey" TO "impurity_exemptions_type_id_fkey";
ALTER INDEX "impurity_exemptions_pattern_id_category_id_key"
  RENAME TO "impurity_exemptions_type_id_category_id_key";

-- 除外：種別 × 法文物質名
ALTER TABLE "impurity_exemption_substances" RENAME COLUMN "pattern_id" TO "type_id";
ALTER TABLE "impurity_exemption_substances"
  RENAME CONSTRAINT "impurity_exemption_substances_pattern_id_fkey"
  TO "impurity_exemption_substances_type_id_fkey";
-- 元の名前は PostgreSQL が 63 文字で切ったもの。新しい名前も Prisma が想定する 63 文字に合わせる
ALTER INDEX "impurity_exemption_substances_pattern_id_statutory_substance_id"
  RENAME TO "impurity_exemption_substances_type_id_statutory_substance_i_key";

-- 判定の根拠（JSONB）の中の鍵も pattern → type にする。
-- `contributions` / `excluded` は `{cas, pct, pattern, sources}` の並び。
-- S21 より後に判定した行だけが `pattern` を持つ。空の配列の行は触らない
UPDATE "product_judgement_hits" h
SET "contributions" = s.arr
FROM (
  SELECT h2."id",
         jsonb_agg(
           CASE WHEN t.e ? 'pattern'
                THEN (t.e - 'pattern') || jsonb_build_object('type', t.e -> 'pattern')
                ELSE t.e END
           ORDER BY t.ord) AS arr
  FROM "product_judgement_hits" h2,
       LATERAL jsonb_array_elements(h2."contributions") WITH ORDINALITY AS t(e, ord)
  WHERE h2."contributions" IS NOT NULL
  GROUP BY h2."id"
) s
WHERE h."id" = s."id";

UPDATE "product_judgement_hits" h
SET "excluded" = s.arr
FROM (
  SELECT h2."id",
         jsonb_agg(
           CASE WHEN t.e ? 'pattern'
                THEN (t.e - 'pattern') || jsonb_build_object('type', t.e -> 'pattern')
                ELSE t.e END
           ORDER BY t.ord) AS arr
  FROM "product_judgement_hits" h2,
       LATERAL jsonb_array_elements(h2."excluded") WITH ORDINALITY AS t(e, ord)
  WHERE h2."excluded" IS NOT NULL
  GROUP BY h2."id"
) s
WHERE h."id" = s."id";
