-- フィードバックの権限を、いまシステム管理（ADMIN）を持っている人に付ける。
-- それ以外の人からは、この移行でフィードバックが見えなくなる（既定はシステム管理者だけ）
INSERT INTO "user_permissions" ("user_id", "permission", "granted_at", "granted_by")
SELECT "user_id", 'FEEDBACK_VIEW'::"Permission", now(), NULL
FROM "user_permissions" WHERE "permission" = 'ADMIN'
ON CONFLICT DO NOTHING;
INSERT INTO "user_permissions" ("user_id", "permission", "granted_at", "granted_by")
SELECT "user_id", 'FEEDBACK_EDIT'::"Permission", now(), NULL
FROM "user_permissions" WHERE "permission" = 'ADMIN'
ON CONFLICT DO NOTHING;
