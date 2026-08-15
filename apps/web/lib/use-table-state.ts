"use client";

import {
  parseTableState,
  serializeTableState,
  type ColumnKind,
  type TableState,
} from "@chem/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * 一覧の状態（並べ替え・絞り込み・ページ）を URL と端末に保持する。
 *
 * - URL に載せる … 詳細から戻ったときに同じ一覧に戻れる／URLを人に送れる
 * - 端末にも覚える … 条件を付けずに画面を開き直したとき、前回の条件を復元する
 *
 * 前回の条件が勝手に効いていると混乱するので、
 * 呼び出し側で「絞り込み中」を必ず明示し、リセットできるようにすること。
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

  const state = useMemo(
    () => parseTableState(ownParams, columnDefs, fallback),
    // fallback は呼び出し側で毎回作られる可能性があるため、依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownParams, columnDefs],
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

  const write = useCallback(
    (next: TableState) => {
      const own = serializeTableState(next, fallback);
      window.localStorage.setItem(storageKey, own.toString());
      router.push(buildUrl(own), { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildUrl, router, storageKey],
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
