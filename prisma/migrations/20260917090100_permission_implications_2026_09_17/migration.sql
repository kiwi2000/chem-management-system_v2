-- 2026-09-17 の権限の見直し。読み出し時にも含意は閉じるが、保存されている集合も同じ形にそろえる。
--
-- 1) 帳票を落とせる（DOCUMENT_DOWNLOAD）は、これまで「データを出力できる」の説明に
--    「帳票のダウンロード」と書いてあったので、それを持っている人に付ける
INSERT INTO "user_permissions" ("user_id", "permission", "granted_at", "granted_by")
SELECT "user_id", 'DOCUMENT_DOWNLOAD'::"Permission", now(), NULL
FROM "user_permissions" WHERE "permission" = 'DATA_EXPORT'
ON CONFLICT DO NOTHING;
-- 落とすにはドキュメントの画面に入れる必要がある
INSERT INTO "user_permissions" ("user_id", "permission", "granted_at", "granted_by")
SELECT "user_id", 'DOCUMENT_CREATE'::"Permission", now(), NULL
FROM "user_permissions" WHERE "permission" = 'DOCUMENT_DOWNLOAD'
ON CONFLICT DO NOTHING;
-- 2) 承認できる → 無効・未公開のデータも見られる（他人の承認待ちが見えないと承認できない）
INSERT INTO "user_permissions" ("user_id", "permission", "granted_at", "granted_by")
SELECT "user_id", 'INACTIVE_VIEW'::"Permission", now(), NULL
FROM "user_permissions" WHERE "permission" = 'APPROVE'
ON CONFLICT DO NOTHING;
-- 3) テンプレートを編集できる → ドキュメントを作れる（メニューと一覧に入れないと編集画面に辿り着けない）
INSERT INTO "user_permissions" ("user_id", "permission", "granted_at", "granted_by")
SELECT "user_id", 'DOCUMENT_CREATE'::"Permission", now(), NULL
FROM "user_permissions" WHERE "permission" = 'DOC_TEMPLATE_EDIT'
ON CONFLICT DO NOTHING;
