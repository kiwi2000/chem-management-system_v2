-- 削除した組織のコードを空ける（2026-11-24 利用者の指示）。
-- これまでは削除してもコードがそのまま残り、同じコードで組織を作り直せなかった。
-- 削除のときと同じく「:内部の id」を付けて退避する（すでに退避してあるものには付けない）
UPDATE "organisations"
SET "code" = "code" || ':' || "id"
WHERE "deleted_at" IS NOT NULL AND "code" NOT LIKE '%:' || "id";
