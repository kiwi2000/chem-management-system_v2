-- PRTR 届出データの入力（PRTR_ENTRY）をシステム管理者に付ける（S22、2026-09-21）。
-- 付けないと管理者が新しい画面を開けず、権限のせいだと気づけない（deploy-with-manual の決まり）。
-- 入力できるのは自分の所属の分だけなので、所属の無い管理者には画面は出ても中身は空。
-- 管理者以外には配らない。誰に配るかは運用の判断
INSERT INTO "user_permissions" ("user_id", "permission", "granted_at", "granted_by")
SELECT "user_id", 'PRTR_ENTRY'::"Permission", now(), NULL
FROM "user_permissions" WHERE "permission" = 'ADMIN'
ON CONFLICT DO NOTHING;
