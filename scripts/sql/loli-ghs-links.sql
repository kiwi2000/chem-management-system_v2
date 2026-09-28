SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
-- LOLI の GHS 複合一覧から「CAS → 原典の項目の識別子（refno）」の結び付きを取り出す（S23 §9-4）。
-- EU 4204: refno は附属書VI の Index 番号。日本 4171: refno は NITE の物質 ID（m-nite-…）。
-- remark に「As 〈親〉 [RR-…]」が入る行は、LOLI がその親の項目から広げた CAS。
-- 列: target_source, cas, key, remark（区分ごとの行は DISTINCT でまとめる。remark の違いは残す）
SELECT DISTINCT 'EU_ANNEX_VI' + CHAR(9) + d.Cas + CHAR(9) + ISNULL(r.value('(refno)[1]','varchar(60)'),'') + CHAR(9) + ISNULL(r.value('(remark)[1]','varchar(1000)'),'')
FROM ListData d
CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
CROSS APPLY x.px.nodes('/root/row') t(r)
WHERE d.ListID = 4204
UNION ALL
SELECT DISTINCT 'NITE' + CHAR(9) + d.Cas + CHAR(9) + ISNULL(r.value('(refno)[1]','varchar(60)'),'') + CHAR(9) + ISNULL(r.value('(remark)[1]','varchar(1000)'),'')
FROM ListData d
CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
CROSS APPLY x.px.nodes('/root/row') t(r)
WHERE d.ListID = 4171
ORDER BY 1;
