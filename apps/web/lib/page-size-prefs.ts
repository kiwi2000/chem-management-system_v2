"use client";

import {
  DEFAULT_PAGE_SIZE_PREFS,
  PAGE_SIZE_COOKIE,
  parsePageSizePrefs,
  type PageSizePrefs,
} from "@chem/shared";
import { useSyncExternalStore } from "react";

/**
 * 1ページの件数の好み。
 *
 * **Cookie から読む。**表が出るたびにサーバーへ聞きに行くわけにいかず、
 * かといって表ごとに引き回すと、どの画面にも同じ配線が要る。
 * 言語やテーマと同じ扱いにしてある。
 */

function read(): string {
  if (typeof document === "undefined") return "";
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${PAGE_SIZE_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(PAGE_SIZE_COOKIE.length + 1)) : "";
}

/*
  同じ中身なら同じものを返す。毎回作り直すと、
  これを見ている画面が延々と描き直される
*/
let cachedRaw: string | null = null;
let cached: PageSizePrefs = DEFAULT_PAGE_SIZE_PREFS;

function snapshot(): PageSizePrefs {
  const raw = read();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parsePageSizePrefs(raw);
  }
  return cached;
}

/** 設定の保存後に呼ぶ。開いている表に、その場で効かせる */
const listeners = new Set<() => void>();
export function pageSizePrefsChanged(): void {
  cachedRaw = null;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePageSizePrefs(): PageSizePrefs {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_PAGE_SIZE_PREFS);
}
