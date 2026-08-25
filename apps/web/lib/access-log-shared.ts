/** 入口の出来事 */
export const SIGNIN_ACTIONS = ["login", "login_failed", "logout"];

/** データが外へ出る出来事。出力・取込みを作ったらここに並ぶ */
export const TAKEOUT_ACTIONS = ["view", "export", "import"];

/**
 * アクセス記録の一覧で絞れるもの。
 * 対象や利用者の「名前」は別の表にあるので、ここでは絞り込めない
 * （監査ログは関連を張らず、あとから組み立てて見せる作りにしてある）。
 */
export const ACCESS_LOG_COLUMNS = [
  { key: "at", kind: "date", field: "at" },
  { key: "action", kind: "enum", field: "action" },
  { key: "actorId", kind: "enum", field: "actorId" },
] as const satisfies { key: string; kind: "date" | "enum"; field: string }[];
