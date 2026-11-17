"use client";

import { useEffect } from "react";

/**
 * 画面ごと読み込み直して、別の画面へ送る。
 *
 * **外枠（最上位の layout の中の AppShell）からは、`redirect()` を投げずにこれを返す。**
 * layout が `redirect()` を投げた状態で画面の読み直し（`router.refresh()`）が走ると、
 * 送り先の画面を休みなく取りに行く（2026-11-17、本番でパスワードを変えた直後に 37 秒で約 90 回。
 * 開発の環境では 2.5 秒で 1,405 回。ログインが切れたあとの読み直しでも同じ）。
 * 読み込み直しなら、送り先で layout が作り直されるので繰り返さない
 */
export function HardRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return null;
}
