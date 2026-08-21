"use client";

import type { Messages, Permission } from "@chem/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  /** 辞書の nav ブロックから文言を引くためのキー */
  key: keyof Messages["nav"];
  /** この権限が無い人にはメニューを出さない（サーバー側でも別途弾く） */
  needs?: Permission;
  /** この接頭辞のパスでも選択中扱いにする（詳細画面など） */
  match?: string[];
}

/**
 * メニュー定義。
 * 未実装の画面もここに並べる（全体像が見えるようにするため）。
 * リンク先が未実装のうちは 404 になる。実装のたびに順次つながる。
 */
const ITEMS: NavItem[] = [
  { href: "/", key: "home" },
  // お知らせを読むだけならホームで足りる。この画面は投稿・編集のためのものなので、
  // 投稿できる人にだけ見せる（他人の分を編集できる権限は投稿権限を含む）
  { href: "/news", key: "news", needs: "NEWS_POST" },
  { href: "/substances", key: "substances", needs: "SUBSTANCE_VIEW" },
  { href: "/products", key: "products", needs: "PRODUCT_VIEW" },
  { href: "/laws", key: "laws", needs: "REGULATION_VIEW", match: ["/laws", "/categories"] },
  {
    href: "/link-versions",
    key: "links",
    needs: "REGULATION_VIEW",
    match: ["/link-versions", "/sources"],
  },
  { href: "/metal-factors", key: "metalFactors", needs: "REGULATION_VIEW" },
  { href: "/import-export", key: "importExport", needs: "DATA_EXPORT" },
  { href: "/doc-templates", key: "docTemplates", needs: "DATA_EXPORT" },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin/groups", key: "groups", needs: "ADMIN", match: ["/admin/groups"] },
  { href: "/admin/users", key: "users", needs: "ADMIN", match: ["/admin/users"] },
  {
    href: "/admin/property-defs",
    key: "propertyDefs",
    needs: "ADMIN",
    match: ["/admin/property-defs"],
  },
  { href: "/admin/settings", key: "settings", needs: "ADMIN", match: ["/admin/settings"] },
];

/**
 * 開発中だけ出す項目。
 * 仕様の確認先を画面の中に置いておくためのもので、本番を作るときに消す。
 * 検証環境でも見せたいので、環境では出し分けない。権限も要らない。
 */
const DEV_ITEMS: NavItem[] = [{ href: "/spec", key: "spec" }];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  const prefixes = item.match ?? [item.href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function SidebarNav({
  permissions,
  onNavigate,
}: {
  permissions: Permission[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { m } = useI18n();
  const allowed = (item: NavItem) => !item.needs || permissions.includes(item.needs);

  const adminItems = ADMIN_ITEMS.filter(allowed);
  const groups: { title: string | null; items: NavItem[]; apart?: boolean }[] = [
    { title: null, items: ITEMS.filter(allowed) },
    ...(adminItems.length > 0 ? [{ title: m.nav.system, items: adminItems }] : []),
    // 業務のメニューと地続きに見えないよう、上を大きめに空ける
    { title: null, items: DEV_ITEMS, apart: true },
  ];

  return (
    <nav className="space-y-4 p-3">
      {groups.map((g, gi) => (
        // 余白は padding で足す（space-y の margin と打ち消し合わないように）
        <div key={gi} className={cn("space-y-1", g.apart && "pt-6")}>
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
                {m.nav[item.key]}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
