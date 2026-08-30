-- 様式に Excel・Word のファイルを預けられるようにする。
--
--   kind      BLOCK … 画面でブロックを積んだもの（今あるものは全部これ）
--             XLSX / DOCX … 預かったファイルの差込札に値を埋めて返す
--   file_*    預かったファイルそのもの。1様式に1つ、数百KBなのでDBに置く
--
-- **既にあるものは触らない。**`kind` は既定の BLOCK が入り、中身は `content` のまま
CREATE TYPE "DocumentTemplateKind" AS ENUM ('BLOCK', 'XLSX', 'DOCX');

ALTER TABLE "document_templates"
  ADD COLUMN "kind" "DocumentTemplateKind" NOT NULL DEFAULT 'BLOCK',
  ADD COLUMN "file_data" BYTEA,
  ADD COLUMN "file_name" VARCHAR(255),
  ADD COLUMN "file_updated_at" TIMESTAMP(3);
