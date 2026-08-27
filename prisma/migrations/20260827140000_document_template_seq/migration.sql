-- テンプレートの「表示順」をやめ、通番にする。
--
-- **並べ替えのために数字を打たせない。**打ち直す手間に見合わないので、
-- 作った順に自動で振る。消しても番号は飛ぶだけで、詰め直さない
-- （生成の記録から、どのテンプレートだったかをたどれるようにするため）。

ALTER TABLE "document_templates" DROP COLUMN "display_order";
ALTER TABLE "document_templates" ADD COLUMN "seq" SERIAL NOT NULL;

CREATE UNIQUE INDEX "document_templates_seq_key" ON "document_templates"("seq");

DROP INDEX IF EXISTS "document_templates_target_display_order_idx";
CREATE INDEX "document_templates_target_seq_idx" ON "document_templates"("target", "seq");
