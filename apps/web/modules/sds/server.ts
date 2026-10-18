import type { ModuleServer } from "../types";
import { ProductGhsSection } from "./components/product-ghs-section";
import { judgementApi } from "./lib/judgement-api";
import { SdsHomePage } from "./pages/home";
import { SdsGhsMovedPage } from "./pages/moved";

/**
 * SDS 作成モジュールの画面。
 * GHS 分類データ（一覧・取り込み・物質の詳細の欄・API）は 2026-10-16 に標準へ移した。
 * ここに残るのは SDS 作成そのもの（いまは入口だけ。混合物の GHS 分類と SDS の作成はここに作る）
 */
const sds: ModuleServer = {
  id: "sds",
  page: (path) => {
    if (path.length === 0) return SdsHomePage;
    // 前の道筋は新しい画面へ送る
    if (path.length === 1 && (path[0] === "ghs" || path[0] === "ghs-data")) return SdsGhsMovedPage;
    return null;
  },
  // /api/modules/sds/ghs-judgement … 製品の GHS 判定（読む・計算する）
  api: (req, path, actor) => judgementApi(req, path, actor),
  // 製品の詳細の法規制判定の下に「GHS 判定（日本）」
  productSections: [ProductGhsSection],
};

export default sds;
