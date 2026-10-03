-- 別の版から中身を写したとき、写し元の版のコード（2026-10-04）
ALTER TABLE "link_version_sources" ADD COLUMN "copied_from" VARCHAR(50);
