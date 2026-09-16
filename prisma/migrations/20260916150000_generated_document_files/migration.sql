-- 帳票を PDF ファイルとして残す（2026-09-16 指示）。落とすときの名前・サーバー上の道筋・大きさ・作れなかった理由
ALTER TABLE "generated_documents"
  ADD COLUMN "file_name" VARCHAR(255),
  ADD COLUMN "file_path" TEXT,
  ADD COLUMN "file_size" INTEGER,
  ADD COLUMN "file_error" TEXT;
