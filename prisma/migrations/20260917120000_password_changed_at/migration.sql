-- パスワードを最後に変えた日時（2026-09-17 指示）。システム設定の「有効期限」の起点にする。
-- いま居る人は「たったいま変えた」ことにする。そうしないと、
-- 期限を入れた瞬間に全員が期限切れになる（既定は 0＝期限なしだが、履歴が無いことに変わりはない）
ALTER TABLE "users"
  ADD COLUMN "password_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
