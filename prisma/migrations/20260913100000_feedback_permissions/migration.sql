-- フィードバック（開発中の窓口）の権限を2つ足す（2026-09-13 指示）。
--
--   FEEDBACK_VIEW  一覧・詳細・未読の印を見られる
--   FEEDBACK_EDIT  投稿・返信・状態の変更・削除ができる（見られるも含む）
--
-- これまではログインしていれば誰でも読み書きできた。既定はシステム管理者だけにする
-- （既存の管理者への付与は次の移行で行う。同じ移行の中では足したばかりの値を使えないため）
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'FEEDBACK_VIEW';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'FEEDBACK_EDIT';
