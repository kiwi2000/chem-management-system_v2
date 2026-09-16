-- テンプレートの対象に「製品の一覧」「物質の一覧」を足す（2026-09-16 指示）
ALTER TYPE "DocumentTarget" ADD VALUE IF NOT EXISTS 'PRODUCT_LIST';
ALTER TYPE "DocumentTarget" ADD VALUE IF NOT EXISTS 'SUBSTANCE_LIST';
