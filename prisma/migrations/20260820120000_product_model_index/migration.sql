-- 型式で絞り込めるようにする（非公開フラグ用の索引は、列を消したときに一緒に消えている）
CREATE INDEX "products_model_value_idx" ON "products"("model_value");
