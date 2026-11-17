-- システム設定の保存の記録を、アクセス記録の画面に出す（2026-11-17）。
-- 前は種類が 'update'（ほかの表の更新と同じ名前）で、アクセス記録の画面は種類で選んでいるので出せなかった。
-- 種類を 'settings_update' に揃える。中身（保存したあとの全部の値）はそのまま。
UPDATE "audit_logs" SET "action" = 'settings_update'
WHERE "entity" = 'system_settings' AND "action" = 'update';
