import { useSyncExternalStore } from "react";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { setBusyCursor } from "@/lib/busy-cursor";
import type { ApiError } from "@/lib/types";

/**
 * 「原材料展開・CAS合算」（上）と「法規制判定」（下）で共有する操作の置き場（2026-09-22 指示）。
 *
 * - 判定対象日: どちらの枠で入れても同じ日付。**効くのは判定表の中身**
 *   （合算表の該当法規制は保存してある判定から作るので、日付では変わらない）
 * - 再計算: 前提が変わっているとき（stale）だけ押せる。押せるかどうかは、
 *   判定を読み込んでいる判定表が知らせる
 *
 * 2 つの枠は親子が離れている（判定は `ProductForm` の中に差し込んでいる）ので、
 * props ではなく画面ごとの小さな置き場で持つ（`judgements-refresh.ts` と同じ考え）
 */
interface State {
  productId: string | null;
  asOf: string;
  /** いつ・どのバージョンで出した判定か（判定表の見出しと同じ。上の合算表にも出す） */
  versionCode: string | null;
  computedAt: string | null;
  /** 前提が変わっていて、判定し直す意味があるか */
  stale: boolean;
  /** 再計算を押せる人か */
  canRejudge: boolean;
  busy: boolean;
}
const EMPTY: State = {
  productId: null,
  asOf: "",
  versionCode: null,
  computedAt: null,
  stale: false,
  canRejudge: false,
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

/** 別の製品の画面になったら空から始める（前の製品の日付を引きずらない） */
export function bindJudgementControls(productId: string) {
  if (state.productId !== productId) set({ ...EMPTY, productId });
}

/** 判定表が読み込んだ結果（いつ・どの版・前提が変わったか・再計算を押せる人か）を知らせる */
export function publishJudgementState(p: {
  versionCode: string | null;
  computedAt: string | null;
  stale: boolean;
  canRejudge: boolean;
}) {
  if (
    state.versionCode !== p.versionCode ||
    state.computedAt !== p.computedAt ||
    state.stale !== p.stale ||
    state.canRejudge !== p.canRejudge
  )
    set(p);
}

export function useJudgementControls() {
  const s = useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
  return { ...s, setAsOf: (asOf: string) => set({ asOf }) };
}

/**
 * この製品だけを、いまの前提で判定し直す（2026-09-19 指示）。
 * 済んだら**画面ごと読み直す。**上の合算表の該当法規制も保存してある判定から作っているので、
 * 片方だけ入れ替えると同じ画面の中で食い違う。
 * 失敗したときは、その文言を返す（出し方は呼んだ枠に任せる）
 */
export async function rejudgeProduct(
  productId: string,
  failedMessage: (status: number) => string,
): Promise<string | null> {
  set({ busy: true });
  setBusyCursor(true);
  try {
    const res = await fetch("/api/products/rejudge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [productId] }),
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
