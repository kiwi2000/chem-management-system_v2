-- データソースの色。画面でどの出どころの値かを一目で分かるようにする。
-- 既に入っているデータには色が無い（NULL）。画面は色が無いときの見せかたを持つ。
ALTER TABLE "sources" ADD COLUMN "color" VARCHAR(7);
