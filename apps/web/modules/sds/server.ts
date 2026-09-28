import type { ComponentType } from "react";
import type { ModulePageProps, ModuleServer, ModuleSubstanceSectionProps } from "../types";
import { sdsApi } from "./api";
import { SdsGhsPage } from "./pages/ghs";
import { SdsGhsDataPage } from "./pages/ghs-data";
import { SdsHomePage } from "./pages/home";
import { SdsGhsSubstanceSection } from "./substance-section";

/** SDS 作成モジュールの画面・API・差込む欄 */
const sds: ModuleServer = {
  id: "sds",
  page: (path) => {
    if (path.length === 0) return SdsHomePage;
    if (path.length === 1 && path[0] === "ghs")
      return SdsGhsPage as unknown as ComponentType<ModulePageProps>;
    if (path.length === 1 && path[0] === "ghs-data")
      return SdsGhsDataPage as unknown as ComponentType<ModulePageProps>;
    return null;
  },
  api: sdsApi,
  substanceSections: [
    SdsGhsSubstanceSection as unknown as ComponentType<ModuleSubstanceSectionProps>,
  ],
};

export default sds;
