-- 原材料の組成が変わって反応前組成（展開・合算）が変わった日時（2026-10-03）
ALTER TABLE "products" ADD COLUMN "pre_reaction_changed_at" TIMESTAMP(3);
