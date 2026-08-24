-- 現在のバージョンは必ず1つ。
-- 利用者が明示的に選んでいなければ、コード順でいちばん新しいものを自動で現在にする。
-- 選んでいればそれに従うので、「選ばれたものかどうか」を覚えておく必要がある。
ALTER TABLE "link_set_versions"
  ADD COLUMN "current_pinned" BOOLEAN NOT NULL DEFAULT false;
