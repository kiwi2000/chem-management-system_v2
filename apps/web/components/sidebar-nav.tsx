"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  /** この接頭辞のパスでも選択中扱いにする（詳細画面など） */
  match?: string[];
}

/**
 * メニュー定義。
 * 未実装の画面もここに並べる（S3 の時点で全体像が見えるようにするため）。
 * リンク先が未実装のうちは 404 になる。実装のたびに順次つながる。
 */
const ITEMS: NavItem[] = [
  { href: "/", label: "ホーム" },
  { href: "/substances", label: "物質" },
  { href: "/products", label: "製品 / 原材料" },
  { href: "/laws", label: "法規制", match: ["/laws", "/categories"] },
  { href: "/link-versions", label: "リンク", match: ["/link-versions", "/sources"] },
  { href: "/metal-factors", label: "金属換算係数" },
  { href: "/import-export", label: "TSV取込 / 出力" },
  { href: "/doc-templates", label: "ドキュメント生成" },
];

const ADMIN_ITEMS: NavItem[] = [{ href: "/admin", label: "管理", match: ["/admin"] }];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  const prefixes = item.match ?? [item.href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function SidebarNav({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups: { title: string | null; items: NavItem[] }[] = [
    { title: null, items: ITEMS },
    ...(isAdmin ? [{ title: "システム", items: ADMIN_ITEMS }] : []),
  ];

  return (
    <nav className="space-y-4 p-3">
      {groups.map((g, gi) => (
        <div key={gi} className="space-y-1">
          {g.title && (
            <div className="text-muted-foreground px-3 pb-1 text-xs font-medium">{g.title}</div>
          )}
          {g.items.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                // 選択中の背景は CSS 変数を直接指定（ユーティリティが環境により効かないため）
                style={active ? { backgroundColor: "var(--secondary)" } : undefined}
                className={cn(
                  "block truncate rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
