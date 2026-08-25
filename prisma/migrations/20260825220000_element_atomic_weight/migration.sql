-- 分子式から「その元素として何％か」を計算するために、標準原子量を持つ。

ALTER TABLE "elements" ADD COLUMN "atomic_weight" DECIMAL(10,4);
