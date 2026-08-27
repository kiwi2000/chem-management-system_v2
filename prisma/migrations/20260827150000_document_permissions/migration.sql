-- ドキュメントの権限と、発行済みの紙面を残す欄。
--
-- **生成は「様式を見て作り、自分が作ったものを見る」まで。**
-- 他人が作ったものは見られない。見せる必要が出たら、そのときに権限を足す
-- （最初から広く見せると、あとで狭めるのが難しい）。
--
-- **紙面は組み立て終わったデータで持つ。**PDF や HTML ではないので数KBで済み、
-- あとから .docx のような出し先が増えても、同じ内容から出せる。

ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'DOC_TEMPLATE_EDIT';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'DOCUMENT_CREATE';

-- 既存の記録には紙面が無い。空の紙面として入れておく（開くと空で出る）
ALTER TABLE "generated_documents"
  ADD COLUMN "content" JSONB NOT NULL DEFAULT '{"orientation":"portrait","blocks":[]}';
ALTER TABLE "generated_documents" ALTER COLUMN "content" DROP DEFAULT;

ALTER TABLE "generated_documents"
  ADD COLUMN "has_composition" BOOLEAN NOT NULL DEFAULT false;

-- 自分が作ったものを引くので、作った人で絞れるようにする
CREATE INDEX "generated_documents_generated_by_generated_at_idx"
  ON "generated_documents"("generated_by", "generated_at");
