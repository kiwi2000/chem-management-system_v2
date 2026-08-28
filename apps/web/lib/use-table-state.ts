"use client";

import {
  DEFAULT_PAGE_SIZE,
  parseTableState,
  serializeTableState,
  type ColumnKind,
  type TableState,
} from "@chem/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  const router = useRouter();
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
  const state = useMemo(
    () =>
      parseTableState(ownParams, columnDefs, {
        ...fallback,
        pageSize: wantsPreferred ? prefs.defaultSize : fallback.pageSize,
      }),
    // fallback は呼び出し側で毎回作られる可能性があるため、依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownParams, columnDefs, prefs.defaultSize, wantsPreferred],
  );

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
      router.push(buildUrl(own), { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildUrl, router, storageKey, effectiveSize],
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
        router.replace(buildUrl(new URLSearchParams(saved)), { scroll: false });
        setReady(true);
        return;
      }
    }
    setReady(true);
    // buildUrl は searchParams に依存して毎回変わるが、この処理は初回だけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUrlState, storageKey, router]);

  const setState = useCallback(
    (updater: (prev: TableState) => TableState) => write(updater(state)),
    [state, write],
  );

  const reset = useCallback(() => {
    window.localStorage.removeItem(storageKey);
    router.replace(buildUrl(new URLSearchParams()), { scroll: false });
  }, [buildUrl, router, storageKey]);

  return { state, setState, reset, ready };
}
