import type { ModuleServer } from "../types";
import { SdsHomePage } from "./pages/home";

/** SDS 作成モジュールの画面。いまは入口（/sds）だけ */
const sds: ModuleServer = {
  id: "sds",
  page: (path) => (path.length === 0 ? SdsHomePage : null),
};

export default sds;
