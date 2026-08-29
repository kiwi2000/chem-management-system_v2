-- 備考に書いてあった「濃度のほかの条件」を、適用条件の欄へ移す。
--
-- 以前は備考の行頭に【条件つき除外】と目印を付けて判定へ伝えていた。
-- 備考には取り込み元の付随情報（EC番号・分類など）も入るため、欄を分けた。
-- **判定はもう目印を見ない。**移さないと、条件つきの号で要確認が出なくなる。
--
-- 目印の付いた行だけを取り出し、目印そのものは落として適用条件に入れる。
-- 備考からはその行を取り除く（同じ文が2か所に残らないように）。
UPDATE "statutory_substances" AS s
SET "applicable_condition" = picked.cond
FROM (
  SELECT id, string_agg(btrim(replace(line, '【条件つき除外】', '')), E'\n') AS cond
  FROM (
    SELECT id, unnest(string_to_array("note", E'\n')) AS line
    FROM "statutory_substances"
    WHERE "note" LIKE '%【条件つき除外】%'
  ) AS lines
  WHERE line LIKE '%【条件つき除外】%'
  GROUP BY id
) AS picked
WHERE s.id = picked.id AND s."applicable_condition" IS NULL;

UPDATE "statutory_substances" AS s
SET "note" = kept.rest
FROM (
  SELECT id, btrim(COALESCE(string_agg(line, E'\n'), '')) AS rest
  FROM (
    SELECT id, unnest(string_to_array("note", E'\n')) AS line
    FROM "statutory_substances"
    WHERE "note" LIKE '%【条件つき除外】%'
  ) AS lines
  WHERE line NOT LIKE '%【条件つき除外】%'
  GROUP BY id
) AS kept
WHERE s.id = kept.id;

-- 目印だけの備考になっていたものは、空文字ではなく空にしておく
UPDATE "statutory_substances" SET "note" = NULL WHERE btrim(COALESCE("note", '')) = '';
