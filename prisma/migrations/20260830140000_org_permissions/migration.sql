-- 組織まわりの権限を2つ足す。
--
--   ORG_EDIT        組織（会社・部署・取引先）を作る・直す・消す
--                   **見るのは権限なし。**帳票の宛先に選ぶため、誰でも一覧を引ける必要がある
--   DOCUMENT_SENDER 帳票の差出人を選ぶ。既定は作った人の会社で、
--                   関連会社の名前で出す・代理で出すときだけ要る
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'DOCUMENT_SENDER';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'ORG_EDIT';
