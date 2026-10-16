import { FileBadge } from "lucide-react";
import type { ModuleManifest } from "../types";
import { SDS_MESSAGES } from "./messages";

/**
 * SDS 作成モジュール（特定のお客さんにだけ渡すオプション）。
 * クライアントでも読み込むので、ここから DB や next/headers に触るものを import しない。
 * GHS分類データは 2026-10-16 に標準へ移した（メニューは法規制のインベントリの下）
 */
const sds: ModuleManifest = {
  id: "sds",
  nav: [
    {
      href: "/sds",
      label: { ja: SDS_MESSAGES.ja.nav, en: SDS_MESSAGES.en.nav },
      icon: FileBadge,
      match: ["/sds"],
    },
  ],
};

export default sds;
