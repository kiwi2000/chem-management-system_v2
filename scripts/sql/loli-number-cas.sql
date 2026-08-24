-- LOLI の一覧から「法令上の番号 → CAS番号」を取り出す。
--
-- こちらの法文物質名とは**番号**で突き合わせる（名前では合わない）。
-- 番号は Data 欄の中に文章で書かれていて、一覧ごとに前置きが違う。
--
--   631  化審法 特定化学物質      Class I; Cabinet Order Number 34, ...
--   634  化審法 監視化学物質      Official Gazette Number 11 (...)
--   4589 化審法 優先評価化学物質  Substance control number 171 (...)
--
-- 先頭に " が付く行があるので、それを落としてから見る。
--
-- 呼び出し方: {LIST_ID} {PREFIX} {CLASS_LIKE} {MAX_NUM} を差し替えてから流す。
-- sqlcmd の -v は値に空白があると受け取れないので、呼ぶ側で置き換える。
SET NOCOUNT ON;

DECLARE @prefix varchar(64) = '{PREFIX}';
-- LEN は末尾の空白を数えないので DATALENGTH を使う（前置きは空白で終わる）
DECLARE @plen int = DATALENGTH('{PREFIX}');

WITH d AS (
    SELECT Cas,
           CASE WHEN LEFT(Data, 1) = CHAR(34) THEN SUBSTRING(Data, 2, LEN(Data)) ELSE Data END AS Data
    FROM ListData
    WHERE ListID = {LIST_ID}
),
n AS (
    SELECT Cas,
           SUBSTRING(Data, CHARINDEX(@prefix, Data) + @plen, 8) AS raw
    FROM d
    WHERE Data LIKE '{CLASS_LIKE}%'
      AND CHARINDEX(@prefix, Data) > 0
)
SELECT DISTINCT
       TRY_CONVERT(int, LEFT(raw, PATINDEX('%[^0-9]%', raw + ' ') - 1)) AS num,
       Cas
FROM n
WHERE TRY_CONVERT(int, LEFT(raw, PATINDEX('%[^0-9]%', raw + ' ') - 1)) BETWEEN 1 AND {MAX_NUM}
ORDER BY num, Cas;
