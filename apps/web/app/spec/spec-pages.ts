/**
 * ユーザーマニュアルの目次。
 * 目次と前後リンクの両方から参照するので、"use client" を付けたファイルには置かない。
 *
 * 並びは、初めて使う人が上から読んでいける順にしてある。
 */
export const SPEC_PAGES = [
  { href: "/spec", label: "はじめに" },
  { href: "/spec/substances", label: "物質を登録する" },
  { href: "/spec/products", label: "製品・原材料を登録する" },
  { href: "/spec/laws", label: "法規制を登録する" },
  { href: "/spec/inventories", label: "インベントリを扱う" },
  { href: "/spec/judgements", label: "法規制の判定を見る" },
  { href: "/spec/lists", label: "探す・絞り込む" },
  { href: "/spec/states", label: "公開までの流れ" },
  { href: "/spec/permissions", label: "だれが何をできるか" },
  { href: "/spec/security", label: "安全のしくみ" },
  { href: "/spec/preferences", label: "自分用の設定" },
  { href: "/spec/feedback", label: "気づいたことを伝える" },
  { href: "/spec/changes", label: "変更履歴" },
  { href: "/spec/pending", label: "保留事項" },
] as const;
