-- ドキュメント生成のテンプレートと、作った記録。
--
-- **テンプレートの中身は JSON。**Word ファイルは預からないので、
-- ファイルの置き場が要らない（コンテナを作り直しても消えない）。
-- 中身の形は `packages/shared/src/document.ts` の `DocumentContent`。
--
-- **作ったファイルの実体は残さない。**残すと、あとで権限が変わった人が
-- 古いものを取れてしまう。誰がいつ何に対して作ったかだけを記録する。

CREATE TYPE "DocumentTarget" AS ENUM ('PRODUCT', 'SUBSTANCE');

CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "code_normalized" VARCHAR(64) NOT NULL,
    "name_ja" TEXT NOT NULL,
    "name_en" TEXT,
    "target" "DocumentTarget" NOT NULL,
    "content" JSONB NOT NULL,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'JA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_templates_code_normalized_key"
  ON "document_templates"("code_normalized");
CREATE INDEX "document_templates_target_display_order_idx"
  ON "document_templates"("target", "display_order");

CREATE TABLE "generated_documents" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "target_ref" TEXT NOT NULL,
    "target_code" VARCHAR(50) NOT NULL,
    "params" JSONB,
    "generated_by" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generated_documents_template_id_generated_at_idx"
  ON "generated_documents"("template_id", "generated_at");
CREATE INDEX "generated_documents_target_ref_idx"
  ON "generated_documents"("target_ref");

ALTER TABLE "generated_documents"
  ADD CONSTRAINT "generated_documents_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "document_templates"("id");
