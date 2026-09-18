-- データソース（バージョン × 種別）に「有効」を付ける（2026-09-18 指示）。
-- 無効にすると、そのバージョンではそのデータソースは無いものとして扱う（リンクは残る。有効に戻せる）。
-- docs/judgment-engine.md が最初から書いていた「active な情報源だけを見る」の列にあたる。
ALTER TABLE "link_version_sources" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
