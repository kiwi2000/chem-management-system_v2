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
 */
export function useTableState(
  storageKey: string,
  columns: { key: string; kind: ColumnKind }[],
  fallback: TableState,
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const columnDefs = useMemo(
    () => columns.map((c) => ({ key: c.key, kind: c.kind })),
    // 列の定義は画面ごとに固定なので、中身の比較はキーの並びで足りる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns.map((c) => `${c.key}:${c.kind}`).join(",")],
  );

  const hasUrlState = useMemo(() => {
    for (const name of searchParams.keys()) {
      if (name === "sort" || name === "page" || name === "size" || name.startsWith("f.")) {
        return true;
      }
    }
    return false;
  }, [searchParams]);

  const state = useMemo(
    () => parseTableState(new URLSearchParams(searchParams.toString()), columnDefs, fallback),
    // fallback は呼び出し側で毎回作られる可能性があるため、依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, columnDefs],
  );

  const write = useCallback(
    (next: TableState, replace: boolean) => {
      const params = serializeTableState(next, fallback);
      const qs = params.toString();
      window.localStorage.setItem(storageKey, qs);
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname, router, storageKey],
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
        router.replace(`${pathname}?${saved}`, { scroll: false });
        setReady(true);
        return;
      }
    }
    setReady(true);
  }, [hasUrlState, pathname, router, storageKey]);

  const setState = useCallback(
    (updater: (prev: TableState) => TableState) => write(updater(state), false),
    [state, write],
  );

  const reset = useCallback(() => {
    window.localStorage.removeItem(storageKey);
    router.replace(pathname, { scroll: false });
  }, [pathname, router, storageKey]);

  return { state, setState, reset, ready };
}
