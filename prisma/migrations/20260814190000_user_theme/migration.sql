-- 画面のテーマをユーザーごとに覚える（言語と同じ扱い）。
ALTER TABLE "users" ADD COLUMN "preferred_theme" TEXT;
