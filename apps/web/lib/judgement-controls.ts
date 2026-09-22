import { useSyncExternalStore } from "react";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { setBusyCursor } from "@/lib/busy-cursor";
import type { ApiError } from "@/lib/types";

/**
 * 「原材料展開・CAS合算」（上）と「法規制判定」（下）で共有する、判定の見出しと「再計算」の置き場
 * （2026-09-22 指示）。
 *
 * - 判定は必ず判定対象日を持つ（2026-09-22 決定）。見出しの日付は**読み取りだけ**。
 *   変えたければ「再計算」で日付を選んで判定し直す（既定は今日）
 * - 再計算を押せるかどうか（判定を直せる人か）は、判定を読み込んでいる判定表が知らせる
 *
 * 2 つの枠は親子が離れている（判定は `ProductForm` の中に差し込んでいる）ので、
 * props ではなく画面ごとの小さな置き場で持つ（`judgements-refresh.ts` と同じ考え）
 */
interface State {
  productId: string | null;
  /** いつ・どの版・どの日付の判定か（判定表の見出しと同じ。上の合算表にも出す） */
  versionCode: string | null;
  computedAt: string | null;
  judgedAsOf: string | null;
  /** サーバーの今日（日本の日付）。判定対象日と違えば「今日の規制ではない」と断る */
  today: string | null;
  /** 前提が変わっていて、判定し直す意味があるか */
  stale: boolean;
  /** 古い理由が「施行日・適用終了日を跨いだ」か（文言を変える） */
  staleByDate: boolean;
  /** 再計算を押せる人か */
  canRejudge: boolean;
  /** 要確認の数。上の合算表の印の横にも同じ数を出す（2026-09-22 指示） */
  reviewCount: number;
  busy: boolean;
}
const EMPTY: State = {
  productId: null,
  versionCode: null,
  computedAt: null,
  judgedAsOf: null,
  today: null,
  stale: false,
  staleByDate: false,
  canRejudge: false,
  reviewCount: 0,
  busy: false,
};
let state: State = EMPTY;
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 別の製品の画面になったら空から始める（前の製品の見出しを引きずらない） */
export function bindJudgementControls(productId: string) {
  if (state.productId !== productId) set({ ...EMPTY, productId });
}

/** 判定表が読み込んだ結果（いつ・どの版・どの日付・前提が変わったか・再計算を押せる人か）を知らせる */
export function publishJudgementState(p: Omit<State, "productId" | "busy">) {
  const changed = (Object.keys(p) as (keyof typeof p)[]).some((k) => state[k] !== p[k]);
  if (changed) set(p);
}

export function useJudgementControls() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

/**
 * この製品だけを、選んだ判定対象日で判定し直して保存する（2026-09-19 指示、日付は 2026-09-22 決定）。
 * 済んだら**画面ごと読み直す。**上の合算表の該当法規制も保存してある判定から作っているので、
 * 片方だけ入れ替えると同じ画面の中で食い違う。
 * 失敗したときは、その文言を返す（出し方は呼んだ枠に任せる）
 */
export async function rejudgeProduct(
  productId: string,
  asOf: string,
  failedMessage: (status: number) => string,
): Promise<string | null> {
  set({ busy: true });
  setBusyCursor(true);
  try {
    const res = await fetch("/api/products/rejudge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [productId], asOf }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return null;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      return body?.error.message ?? failedMessage(res.status);
    }
    window.location.reload();
    return null;
  } finally {
    set({ busy: false });
    setBusyCursor(false);
  }
}
