-- データソース種別は「コード」と「説明」の2つで足りることになった。
-- 名称・英語名・有効フラグ・URLは使わないので落とす。
-- 名前を別に持たなくても、コードと説明で何のデータか分かるため。
ALTER TABLE "sources"
  DROP COLUMN "name_ja",
  DROP COLUMN "name_en",
  DROP COLUMN "active_flag",
  DROP COLUMN "url";
