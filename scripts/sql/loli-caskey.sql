-- LOLI の CasKeys から「別の番号 → CAS」を取り出す。
--
-- `CasKeys` は物質側の別名の番号（Datafeed 説明書 4.2）。
-- 一覧（ListData）ではなく**物質そのものに付いている番号**なので、
-- 法令の一覧に番号が入っていなくてもここから引ける。
--
--   {KEY_TYPE}  DataKeyTypes.DataKeyType（`Annex` `EC` `ENCS` `ISHL` など）
--
-- `Annex` は EU CLP規則 附属書VI の Index番号（`001-001-00-9`）。
SET NOCOUNT ON;
SELECT LTRIM(RTRIM(CAST(DataKey AS varchar(60)))) AS k, Cas AS cas
FROM CasKeys
WHERE DataKeyType = '{KEY_TYPE}'
ORDER BY k, cas;
