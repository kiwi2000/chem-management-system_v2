-- CAS番号ごとの物質名。日本語と英語を1行にまとめて取り出す。
--
-- リンクの取り出し（loli-key-cas.sql など）は「鍵とCAS」だけなので、
-- 名前はここで別に引いて、取り込むときに突き合わせる。
-- 名前を各ファイルに混ぜると、同じ名前が何度も並んでファイルが太る。
--
--   英語 … CasNames の代表名
--   日本語 … CasSyns の LangID=21。複数あるので、代表のものを1つだけ採る
--
-- 取り込みに使う一覧に出てくるCASだけに絞る。全部だと65万件になるため。
-- タブと改行は空白に潰す。TSVとして読むため。
SET NOCOUNT ON;

WITH ja AS (
    SELECT Cas,
           Name,
           ROW_NUMBER() OVER (PARTITION BY Cas ORDER BY IsPrimary DESC, LEN(Name) ASC, SynID ASC) AS rn
    FROM CasSyns
    WHERE LangID = 21
)
SELECT n.Cas,
       LEFT(REPLACE(REPLACE(REPLACE(ISNULL(ja.Name, ''), CHAR(9), ' '), CHAR(13), ' '), CHAR(10), ' '), 400) AS name_ja,
       LEFT(REPLACE(REPLACE(REPLACE(ISNULL(n.Name, ''), CHAR(9), ' '), CHAR(13), ' '), CHAR(10), ' '), 400) AS name_en
FROM CasNames n
LEFT JOIN ja ON ja.Cas = n.Cas AND ja.rn = 1
WHERE n.Cas IN (SELECT Cas FROM ListData WHERE ListID IN (631, 634, 4589, 10077, 9013, 9014, 1015, 1818, 1816, 2226, 9906, 9908, 1813))
ORDER BY n.Cas;
