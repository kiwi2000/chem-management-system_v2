-- テンプレートの対象に「規制区分」を足す（2026-09-16 指示）
ALTER TYPE "DocumentTarget" ADD VALUE IF NOT EXISTS 'CATEGORY';
