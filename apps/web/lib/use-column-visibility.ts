"use client";

import { useCallback, useEffect, useState } from "react";

interface Saved {
  /** 隠している列 */
  hidden: string[];
  /** 並べ替えた列。ここに無い列は、元の並びのまま後ろに続く */
  order: string[];
}

/**
 * 表に出す列と、その並び。端末ごとに覚える。
 *
 * **覚えるのは「隠した列」のほう。**列が増えたときに、
 * 新しい列が黙って隠れたままになるのを避けるため
 * （出す列を覚える形にすると、覚えた時点に無かった列は出てこない）。
 *
 * 並びも同じ考えで、**覚えた並びに無い列は元の位置のまま**にする。
 */
export function useColumnVisibility(storageKey: string) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Saved | string[];
      // 昔は隠した列だけを並びで持っていた。読めるようにしておく
      if (Array.isArray(saved)) {
        setHidden(new Set(saved));
        return;
      }
      setHidden(new Set(saved.hidden ?? []));
      setOrder(saved.order ?? []);
    } catch {
      // 読めない中身は無かったことにする。全部出しておけば困らない
    }
  }, [storageKey]);

  const write = useCallback(
    (nextHidden: Set<string>, nextOrder: string[]) => {
      setHidden(nextHidden);
      setOrder(nextOrder);
      try {
        const saved: Saved = { hidden: [...nextHidden], order: nextOrder };
        window.localStorage.setItem(storageKey, JSON.stringify(saved));
      } catch {
        // 端末が保存を断ることがある。そのときはこの画面のあいだだけ効く
      }
    },
    [storageKey],
  );

  const toggle = useCallback(
    (key: string) => {
      const next = new Set(hidden);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      write(next, order);
    },
    [hidden, order, write],
  );

  /**
   * 列を、掴んだ位置から落とした位置へ動かす。
   *
   * **並びは実際に見えている順で決める。**隠している列を挟むと、
   * 掴んだ場所と落ちる場所が合わなくなる。
   */
  const moveTo = useCallback(
    (visibleKeys: string[], from: number, to: number) => {
      if (from === to || from < 0 || to < 0) return;
      if (from >= visibleKeys.length || to >= visibleKeys.length) return;
      const next = [...visibleKeys];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      write(hidden, next);
    },
    [hidden, write],
  );

  /** 出し入れも並びも、決めていない状態に戻す */
  const reset = useCallback(() => write(new Set(), []), [write]);

  return {
    hidden,
    order,
    toggle,
    moveTo,
    reset,
    changed: hidden.size > 0 || order.length > 0,
  };
}

/**
 * 覚えた並びを、いまの列に当てる。
 * **覚えた並びに無い列は、元の位置のまま。**列が増えても迷子にしない
 */
export function applyColumnOrder<T extends { key: string }>(columns: T[], order: string[]): T[] {
  if (order.length === 0) return columns;
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const known = order.flatMap((k) => {
    const c = byKey.get(k);
    return c ? [c] : [];
  });
  const rest = columns.filter((c) => !order.includes(c.key));
  return [...known, ...rest];
}
