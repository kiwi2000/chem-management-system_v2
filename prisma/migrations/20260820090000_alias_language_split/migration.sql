-- 別名を日本語・英語で独立して持てるようにする。
-- 日本語別名と英語別名は件数が一致しないため、どちらか一方だけの行を許す。
-- 「両方 null は不可」はアプリ層（Zod）で担保する。
ALTER TABLE "substance_aliases" ALTER COLUMN "name_ja" DROP NOT NULL;
ALTER TABLE "product_aliases" ALTER COLUMN "name_ja" DROP NOT NULL;
