"use client";

import {
  DEFAULT_PAGE_SIZE,
  parseTableState,
  serializeTableState,
  type ColumnKind,
  type TableState,
} from "@chem/shared";
import { usePathname, useSearchParams } from "next/navigation";
import { usePageSizePrefs } from "@/lib/page-size-prefs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * 一覧の状態（並べ替え・フィルター・ページ）を URL と端末に保持する。
 *
 * - URL に載せる … 詳細から戻ったときに同じ一覧に戻れる／URLを人に送れる
 * - 端末にも覚える … 条件を付けずに画面を開き直したとき、前回の条件を復元する
 *
 * 前回の条件が勝手に効いていると混乱するので、
 * 呼び出し側で「フィルター中」を必ず明示し、リセットできるようにすること。
 *
 * 1つの画面に表が2つ以上あるときは `paramPrefix` を指定する。
 * 指定しないと両方が同じ `sort` や `f.○○` を書き合って壊れる。
 */
export function useTableState(
  storageKey: string,
  columns: { key: string; kind: ColumnKind }[],
  fallback: TableState,
  paramPrefix = "",
) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const prefix = paramPrefix ? `${paramPrefix}.` : "";

  /** この表が使うクエリかどうか（他の表のぶんは触らない） */
  const isOwn = useCallback(
    (name: string) => {
      if (!name.startsWith(prefix)) return false;
      const key = name.slice(prefix.length);
      return key === "sort" || key === "page" || key === "size" || key.startsWith("f.");
    },
    [prefix],
  );

  const columnDefs = useMemo(
    () => columns.map((c) => ({ key: c.key, kind: c.kind })),
    // 列の定義は画面ごとに固定なので、中身の比較はキーの並びで足りる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns.map((c) => `${c.key}:${c.kind}`).join(",")],
  );

  /** URL からこの表のぶんだけ取り出し、接頭辞を外した形にする */
  const ownParams = useMemo(() => {
    const out = new URLSearchParams();
    for (const [name, value] of searchParams.entries()) {
      if (isOwn(name)) out.set(name.slice(prefix.length), value);
    }
    return out;
  }, [searchParams, isOwn, prefix]);

  const hasUrlState = ownParams.size > 0;

  /*
    1ページの件数は、**画面の決め打ちよりその人の設定を先に見る。**
    画面ごとの数は「この表はこれくらい」という目安でしかなく、
    実際に何行が読みやすいかは、使う人の画面の高さで決まる。

    **しまうときは画面の既定と比べる**（`write` の `fallback`）。
    そうしないと、その人の既定と画面の既定が違うときに `size` が省かれ、
    サーバーが画面の既定で数えてしまう
  */
  const prefs = usePageSizePrefs();
  /*
    **画面が件数を決めているなら、そちらを立てる。**
    「件数が知れているので全部出す」といった表は、人の好みで切ってはいけない
    （ページ送りを置いていないので、切れたぶんに手が届かなくなる）
  */
  const wantsPreferred = fallback.pageSize === DEFAULT_PAGE_SIZE;
  const urlState = useMemo(
    () =>
      parseTableState(ownParams, columnDefs, {
        ...fallback,
        pageSize: wantsPreferred ? prefs.defaultSize : fallback.pageSize,
      }),
    // fallback は呼び出し側で毎回作られる可能性があるため、依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownParams, columnDefs, prefs.defaultSize, wantsPreferred],
  );

  /*
    **書き換えた条件は、URL に届くまでここで覚えておき、そちらを返す**（2026-10-31）。
    URL の書き換えは少し遅れて届く。届く前に次の操作をすると、古い条件から計算して送るので、
    前の操作が消えていた（ユーザーの絞り込みで、続けて外したチェックが戻った）。
    URL がこの条件に追いついたら覚えを捨て、以後は URL を正とする

    **URL はブラウザに直接書かせる（`history.pushState`）。`router.push` は使わない**（2026-11-02）。
    `router.push` を続けて呼ぶと、Next.js が後のほうを捨てることがあり、表は絞れているのに
    URL だけ古い条件のまま残った（取り込み結果の画面で、文字の条件を 2 つ続けて入れたとき）。
    一覧の条件はどの画面もサーバー側では読まず、画面がデータを取りに行くので、Next.js を通す必要がない。
    直接書いても `useSearchParams` には Next.js が届けてくれる
  */
  const [pending, setPending] = useState<{ query: string; state: TableState } | null>(null);
  const ownQuery = sortedQuery(ownParams);
  useEffect(() => {
    if (pending && pending.query === ownQuery) setPending(null);
  }, [pending, ownQuery]);
  // 戻る・進むで URL が変わったら、覚えていた条件より URL を立てる
  useEffect(() => {
    const drop = () => setPending(null);
    window.addEventListener("popstate", drop);
    return () => window.removeEventListener("popstate", drop);
  }, []);
  const state = pending?.state ?? urlState;

  /** 他の表のクエリを残したまま、この表のぶんだけ書き換える */
  const buildUrl = useCallback(
    (ownQuery: URLSearchParams) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const name of [...params.keys()]) if (isOwn(name)) params.delete(name);
      for (const [key, value] of ownQuery.entries()) params.set(`${prefix}${key}`, value);
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [searchParams, isOwn, prefix, pathname],
  );

  /** いま読む側が使う既定の件数。書くときもこれと比べないと、選んだ数が消える */
  const effectiveSize = wantsPreferred ? prefs.defaultSize : fallback.pageSize;

  const write = useCallback(
    (next: TableState) => {
      const own = serializeTableState(next, fallback);
      /*
        **その人の既定と違う件数を選んだら、必ず書き残す。**
        `serializeTableState` は共通の既定（15）と比べて省くので、
        たとえば既定を10にしている人が15を選ぶと `size` が省かれ、
        読み直したときに既定の10へ戻ってしまい、**15を選べなくなる**
      */
      if (!own.has("size") && next.pageSize !== effectiveSize) {
        own.set("size", String(next.pageSize));
      }
      window.localStorage.setItem(storageKey, own.toString());
      // いまの URL と同じに戻したときは、URL が変わらず追いつきを待てないので覚えない
      const query = sortedQuery(own);
      setPending(query === ownQuery ? null : { query, state: next });
      window.history.pushState(null, "", buildUrl(own));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildUrl, storageKey, effectiveSize, ownQuery],
  );

  // 条件なしで開かれたときだけ、前回の条件を復元する（1回だけ）
  const restored = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (!hasUrlState) {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        window.history.replaceState(null, "", buildUrl(new URLSearchParams(saved)));
        setReady(true);
        return;
      }
    }
    setReady(true);
    // buildUrl は searchParams に依存して毎回変わるが、この処理は初回だけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUrlState, storageKey]);

  const setState = useCallback(
    (updater: (prev: TableState) => TableState) => write(updater(state)),
    [state, write],
  );

  const reset = useCallback(() => {
    setPending(null);
    window.localStorage.removeItem(storageKey);
    window.history.replaceState(null, "", buildUrl(new URLSearchParams()));
  }, [buildUrl, storageKey]);

  return { state, setState, reset, ready };
}

/** 並びの違いを無視して比べるための、キー順に並べたクエリ文字列 */
function sortedQuery(params: URLSearchParams): string {
  const copy = new URLSearchParams(params);
  copy.sort();
  return copy.toString();
}
