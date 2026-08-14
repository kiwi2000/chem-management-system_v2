/**
 * ログイン状態にかかわる画面の決めごと。
 * middleware（Edgeランタイム）とサーバーコンポーネント、クライアントの3か所から参照するので、
 * どこにも依存しないこのファイルに置く。
 */

/** 未ログインでも開ける画面。ここに載せた接頭辞はログイン画面へ飛ばさない */
export const PUBLIC_PATHS = ["/login"];

/** middleware がパスを渡すためのヘッダー（サーバーコンポーネントからは URL を読めない） */
export const PATH_HEADER = "x-chem-path";

/**
 * セッションが切れたときに送る先。
 * `expired=1` が付いていると、Cookie が残っていても middleware がログイン画面を通す
 * （付けないと「Cookie あり → ホームへ」と堂々巡りになる）。
 */
export const EXPIRED_LOGIN_URL = "/login?expired=1";
