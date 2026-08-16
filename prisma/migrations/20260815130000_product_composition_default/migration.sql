-- 組成の既定は「公開する」。
-- 非公開にできるのは COMPOSITION_VIEW_PRIVATE を持つ人だけなので、
-- 既定が「非公開」だと、その権限が無い人が作った製品の組成を本人が見られなくなる。
ALTER TABLE "products" ALTER COLUMN "composition_public_flag" SET DEFAULT true;
