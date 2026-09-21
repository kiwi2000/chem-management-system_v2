-- PRTR 管理者（PRTR_ADMIN）をシステム管理者に付ける（S22-1、2026-09-21）。
-- 付けないと管理者が PRTR の画面を開けず、権限のせいだと気づけない（deploy-with-manual の決まり）。
-- PRTR_ADMIN は PRTR_GROUP と PRTR_SITE を含むので、含意も同時に閉じる。
-- 管理者以外には配らない。誰に配るかは運用の判断
INSERT INTO "user_permissions" ("user_id", "permission", "granted_at", "granted_by")
SELECT "user_id", 'PRTR_ADMIN'::"Permission", now(), NULL
FROM "user_permissions" WHERE "permission" = 'ADMIN'
ON CONFLICT DO NOTHING;
INSERT INTO "user_permissions" ("user_id", "permission", "granted_at", "granted_by")
SELECT "user_id", 'PRTR_GROUP'::"Permission", now(), NULL
FROM "user_permissions" WHERE "permission" = 'PRTR_ADMIN'
ON CONFLICT DO NOTHING;
INSERT INTO "user_permissions" ("user_id", "permission", "granted_at", "granted_by")
SELECT "user_id", 'PRTR_SITE'::"Permission", now(), NULL
FROM "user_permissions" WHERE "permission" = 'PRTR_GROUP'
ON CONFLICT DO NOTHING;
