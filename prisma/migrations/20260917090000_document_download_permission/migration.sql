-- 帳票をファイルで落とす権限（2026-09-17 指示）。
-- 作る・画面で見る（DOCUMENT_CREATE）と、ファイルで持ち出す（この権限）を分ける。
-- 新しい値を同じトランザクションの中で使えないので、付与は次の移行で行う
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'DOCUMENT_DOWNLOAD';
