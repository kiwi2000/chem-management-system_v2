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
 * 1回の要求ごとに作る使い捨ての印。差し込まれた script を実行させないために使う。
 * middleware が作って、レイアウトが読む。Next.js 自身もこの名前を見て、
 * 自分が出す script にこの印を付ける。
 */
export const NONCE_HEADER = "x-nonce";

/**
 * セッションが切れたときに送る先。
 * `expired=1` が付いていると、Cookie が残っていても middleware がログイン画面を通す
 * （付けないと「Cookie あり → ホームへ」と堂々巡りになる）。
 *
 * **なぜ切れたのかで文言を変える。**放置による自動ログアウトと、
 * 設定が変わって切られた場合とでは、次にすることが違う。
 * ひとまとめに「一定時間操作がなかったため」と出すと、
 * 何もしていないのに放置したと言われることになる。
 */
export const EXPIRED_LOGIN_URL = "/login?expired=1";

/** 放置による自動ログアウト。理由が分かっているときだけこちらを使う */
export const IDLE_LOGIN_URL = "/login?expired=1&reason=idle";
