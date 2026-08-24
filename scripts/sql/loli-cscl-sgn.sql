-- 化審法 特定一般化学物質（LOLI の一覧 10077）。
--
-- ここだけは通し番号が入っていない。Data に入っているのは**官報公示整理番号**で、
--   Present (5)-7143
-- という形。こちらの法文物質名は備考に「官報公示整理番号: 5-7143」と持っているので、
-- 丸括弧を外した形（5-7143）に揃えて突き合わせる。
SET NOCOUNT ON;

WITH d AS (
    SELECT Cas,
           CASE WHEN LEFT(Data, 1) = CHAR(34) THEN SUBSTRING(Data, 2, LEN(Data)) ELSE Data END AS Data
    FROM ListData
    WHERE ListID = 10077
),
n AS (
    SELECT Cas,
           -- 「Present (」は9文字。そこから閉じ括弧までが分類番号、続きが枝番
           SUBSTRING(Data, CHARINDEX('Present (', Data) + 9, 20) AS raw
    FROM d
    WHERE CHARINDEX('Present (', Data) > 0
)
SELECT DISTINCT
       REPLACE(LEFT(raw, PATINDEX('%[^0-9()-]%', raw + ' ') - 1), ')', '') AS gazette,
       Cas
FROM n
ORDER BY gazette, Cas;
