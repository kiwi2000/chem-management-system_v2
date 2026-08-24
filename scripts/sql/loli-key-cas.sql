-- LOLI の一覧から「鍵 → CAS番号」を取り出す。
--
-- 鍵は Data 欄の中に文章で埋まっていて、法令ごとに書き方が違う。
-- ここでは「この語の後ろから、この記号の手前まで」を切り出すだけにして、
-- 番号への直しかたは取り込む側（seed-cas-links.ts）に持たせている。
-- SQL側で法令ごとの事情を抱え込むと、増えるたびにSQLが増えるため。
--
--   9013 化管法 第一種  Ordinance No. 459, [...]        → START='Ordinance No. ' END=','
--   1015 毒劇法        [Order Article 2-1-79] ...       → START='[Order Article ' END=']'
--   9907 安衛法 表示    (Attached table, 9-23, [...])    → START='(Attached table, ' END=','
--   2226 安衛法 特化則  ([2-10], Cadmium ...)            → START='([' END=']'
--
-- 先頭に " が付く行があるので、それを落としてから見る。
--
-- 呼び出し方: {LIST_ID} {CLASS_LIKE} {START} {END} を差し替えてから流す。
-- sqlcmd の -v は値に空白があると受け取れないので、呼ぶ側で置き換える。
SET NOCOUNT ON;

DECLARE @start varchar(64) = '{START}';
-- LEN は末尾の空白を数えないので DATALENGTH を使う（切り出しの語は空白で終わることが多い）
DECLARE @slen int = DATALENGTH('{START}');

WITH d AS (
    SELECT Cas,
           CASE WHEN LEFT(Data, 1) = CHAR(34) THEN SUBSTRING(Data, 2, LEN(Data)) ELSE Data END AS Data
    FROM ListData
    WHERE ListID = {LIST_ID}
),
n AS (
    SELECT Cas,
           SUBSTRING(Data, CHARINDEX(@start, Data) + @slen, 24) AS raw
    FROM d
    WHERE Data LIKE '{CLASS_LIKE}%'
      AND CHARINDEX(@start, Data) > 0
)
SELECT DISTINCT
       LEFT(raw, CHARINDEX('{END}', raw + '{END}') - 1) AS k,
       Cas
FROM n
WHERE LEN(LEFT(raw, CHARINDEX('{END}', raw + '{END}') - 1)) > 0
ORDER BY k, Cas;
