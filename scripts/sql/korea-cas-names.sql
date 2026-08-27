-- 韓国の一覧に出てくるCASの名前。日本語と英語を1行にまとめて取り出す。
--
-- 号の名前（`listedunder`）が入っていない一覧があるので、
-- そこは**その号の代表CASの名前**を法文物質名として使う。
-- 名前をリンクのファイルに混ぜると同じ名前が何度も並ぶので、ここで別に引く。
--
--   英語 … CasNames の代表名
--   日本語 … CasSyns の LangID=21。複数あるので代表を1つだけ採る
--
-- タブと改行は空白に潰す。TSVとして読むため。
SET NOCOUNT ON;

WITH ja AS (
    SELECT Cas, Name,
           ROW_NUMBER() OVER (PARTITION BY Cas ORDER BY IsPrimary DESC, LEN(Name) ASC, SynID ASC) AS rn
    FROM CasSyns
    WHERE LangID = 21
)
SELECT n.Cas,
       LEFT(REPLACE(REPLACE(REPLACE(ISNULL(ja.Name, ''), CHAR(9), ' '), CHAR(13), ' '), CHAR(10), ' '), 400) AS name_ja,
       LEFT(REPLACE(REPLACE(REPLACE(ISNULL(n.Name, ''), CHAR(9), ' '), CHAR(13), ' '), CHAR(10), ' '), 400) AS name_en
FROM CasNames n
LEFT JOIN ja ON ja.Cas = n.Cas AND ja.rn = 1
WHERE n.Cas IN (
  SELECT Cas FROM ListData
  WHERE ListID IN (1887, 1888, 7914, 1581, 1580, 3564, 2480, 2479, 9020, 6285)
)
ORDER BY n.Cas;
