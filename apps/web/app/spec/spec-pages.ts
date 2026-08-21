/**
 * 仕様書の目次。ページを増やしたらここに足す。
 * 目次（クライアント側）と本文（サーバー側）の両方から読むので、
 * "use client" を付けたファイルには置かない。
 */
export const SPEC_PAGES = [
  { href: "/spec", label: "この資料について" },
  { href: "/spec/states", label: "状態と承認の流れ" },
  { href: "/spec/permissions", label: "だれが何をできるか" },
  { href: "/spec/data", label: "登録する情報" },
  { href: "/spec/lists", label: "一覧とフィルター" },
  { href: "/spec/feedback", label: "フィードバック" },
  { href: "/spec/changes", label: "変更の履歴" },
] as const;
