import { Database, FileBadge, Upload } from "lucide-react";
import type { ModuleManifest } from "../types";
import { SDS_MESSAGES } from "./messages";

/**
 * SDS 作成モジュール（特定のお客さんにだけ渡すオプション）。
 * クライアントでも読み込むので、ここから DB や next/headers に触るものを import しない
 */
const sds: ModuleManifest = {
  id: "sds",
  nav: [
    {
      label: { ja: SDS_MESSAGES.ja.nav, en: SDS_MESSAGES.en.nav },
      icon: FileBadge,
      match: ["/sds"],
      children: [
        {
          href: "/sds/ghs-data",
          label: { ja: SDS_MESSAGES.ja.navGhsData, en: SDS_MESSAGES.en.navGhsData },
          icon: Database,
          needs: "SUBSTANCE_VIEW",
          match: ["/sds/ghs-data"],
        },
        {
          href: "/sds/ghs",
          label: { ja: SDS_MESSAGES.ja.navGhsImport, en: SDS_MESSAGES.en.navGhsImport },
          icon: Upload,
          match: ["/sds/ghs"],
        },
      ],
    },
  ],
};

export default sds;
