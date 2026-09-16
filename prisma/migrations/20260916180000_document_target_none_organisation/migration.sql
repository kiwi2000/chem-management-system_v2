-- テンプレートの対象に「組織」と「対象なし（汎用）」を足す（2026-09-16 指示）
ALTER TYPE "DocumentTarget" ADD VALUE IF NOT EXISTS 'ORGANISATION';
ALTER TYPE "DocumentTarget" ADD VALUE IF NOT EXISTS 'NONE';
