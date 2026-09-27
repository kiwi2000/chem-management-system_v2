-- 添付ファイルの作り直し（2026-09-27 指示）
--   件名を足す（今ある行はファイル名を件名にする）
--   備考を「説明」に改める
--   種類を決め打ちの型から文字に（選択肢はシステム設定で決める）。今ある値は日本語の名前に直す
--   「組成を見られる人だけ」の印をやめる（添付はすべて組成を見られる人だけに見せる）

ALTER TABLE "product_attachments" ADD COLUMN "title" VARCHAR(255) NOT NULL DEFAULT '';
UPDATE "product_attachments" SET "title" = "file_name";
ALTER TABLE "product_attachments" ALTER COLUMN "title" DROP DEFAULT;

ALTER TABLE "product_attachments" RENAME COLUMN "note" TO "description";

ALTER TABLE "product_attachments" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "product_attachments" ALTER COLUMN "kind" DROP NOT NULL;
ALTER TABLE "product_attachments" ALTER COLUMN "kind" TYPE VARCHAR(100) USING (
  CASE "kind"::text
    WHEN 'TEST_REPORT' THEN '試験成績書'
    WHEN 'SURVEY' THEN '調査回答'
    WHEN 'DRAWING' THEN '図面'
    WHEN 'OTHER' THEN 'その他'
    ELSE "kind"::text
  END
);
DROP TYPE "AttachmentKind";

ALTER TABLE "product_attachments" DROP COLUMN "composition_only";
