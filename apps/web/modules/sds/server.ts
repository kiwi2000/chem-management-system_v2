import type { ModuleServer } from "../types";
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
};

export default sds;
