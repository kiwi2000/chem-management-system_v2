import type { ModuleManifest, ModuleNavItem } from "@/modules/types";

/**
 * 本体のメニューに、モジュールの項目を差し込む。
 *
 * 目印（anchor）の項目の**直後**に、モジュールの並び順で入れる。目印が無ければ末尾。
 * モジュールが 1 つも無ければ元の並びをそのまま返す（SDS なし版はこの道を通る）
 */
export function withModuleNav<T>(
  items: T[],
  modules: ModuleManifest[],
  isAnchor: (item: T) => boolean,
  toItem: (nav: ModuleNavItem) => T,
): T[] {
  const extra = modules.flatMap((mod) => mod.nav.map(toItem));
  if (extra.length === 0) return items;
  const at = items.findIndex(isAnchor);
  if (at < 0) return [...items, ...extra];
  return [...items.slice(0, at + 1), ...extra, ...items.slice(at + 1)];
}
