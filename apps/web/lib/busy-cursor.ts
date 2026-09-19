/**
 * 時間のかかる処理のあいだ、マウスカーソルを待ち状態にする（2026-09-19 指示）。
 *
 * 見た目は `app/globals.css` の `body[data-busy="true"]` が受け持つ。
 * ボタンを押せなくするだけでは、何も起きていないように見える時間がある
 */
export function setBusyCursor(on: boolean) {
  if (typeof document === "undefined") return;
  if (on) document.body.dataset.busy = "true";
  else delete document.body.dataset.busy;
}
