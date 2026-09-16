-- 他の人が作ったドキュメントも見られる権限（2026-09-16 指示）。
-- 組成の載ったものは組成の権限、未公開の製品・物質のものは未公開の権限も要る（アプリ側で見る）
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'DOCUMENT_VIEW_ALL';
