-- 1ページの件数の好み。`15,25,50,100|50` の形（選択肢｜既定）。
-- 画面の高さも読みたい量も人によって違うので、決め打ちにしない。

ALTER TABLE "users" ADD COLUMN "preferred_page_sizes" TEXT;
