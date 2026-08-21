"use client";

import type { Messages, Permission } from "@chem/shared";
import {
  ArrowDownUp,
  BookOpen,
  ChevronRight,
  FileText,
  FlaskConical,
  Home,
  Link2,
  Megaphone,
  MessageSquare,
  Package,
  Scale,
  Settings,
  Sigma,
  Tags,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  /** 行頭のアイコン。文字を読まなくても見当が付くように置く */
  icon: LucideIcon;
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
  { href: "/", key: "home", icon: Home },
  // お知らせを読むだけならホームで足りる。この画面は投稿・編集のためのものなので、
  // 投稿できる人にだけ見せる（他人の分を編集できる権限は投稿権限を含む）
  { href: "/news", key: "news", icon: Megaphone, needs: "NEWS_POST" },
  { href: "/substances", key: "substances", icon: FlaskConical, needs: "SUBSTANCE_VIEW" },
  { href: "/products", key: "products", icon: Package, needs: "PRODUCT_VIEW" },
  {
    href: "/laws",
    key: "laws",
    icon: Scale,
    needs: "REGULATION_VIEW",
    match: ["/laws", "/categories"],
  },
  {
    href: "/link-versions",
    key: "links",
    icon: Link2,
    needs: "REGULATION_VIEW",
    match: ["/link-versions", "/sources"],
  },
  { href: "/metal-factors", key: "metalFactors", icon: Sigma, needs: "REGULATION_VIEW" },
  { href: "/import-export", key: "importExport", icon: ArrowDownUp, needs: "DATA_EXPORT" },
  { href: "/doc-templates", key: "docTemplates", icon: FileText, needs: "DATA_EXPORT" },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin/groups", key: "groups", icon: Users, needs: "ADMIN", match: ["/admin/groups"] },
  { href: "/admin/users", key: "users", icon: UserCog, needs: "ADMIN", match: ["/admin/users"] },
  {
    href: "/admin/property-defs",
    key: "propertyDefs",
    icon: Tags,
    needs: "ADMIN",
    match: ["/admin/property-defs"],
  },
  {
    href: "/admin/settings",
    key: "settings",
    icon: Settings,
    needs: "ADMIN",
    match: ["/admin/settings"],
  },
];

/**
 * 開発中だけ出す項目。
 * 仕様の確認先を画面の中に置いておくためのもので、本番を作るときに消す。
 * 検証環境でも見せたいので、環境では出し分けない。権限も要らない。
 */
const DEV_ITEMS: NavItem[] = [
  { href: "/spec", key: "spec", icon: BookOpen },
  { href: "/feedback", key: "feedback", icon: MessageSquare },
];

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

  /**
   * 「システム」の開閉。普段は畳んでおき、押したときに中身を出す。
   * ただし配下の画面を開いている間は開けておく（選択中の項目が隠れてしまうため）。
   */
  const inAdmin = adminItems.some((item) => isActive(pathname, item));
  const [openSystem, setOpenSystem] = useState(false);
  const systemOpen = openSystem || inAdmin;

  const renderItem = (item: NavItem, indented: boolean) => {
    const active = isActive(pathname, item);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        // 選択中の背景は CSS 変数を直接指定（ユーティリティが環境により効かないため）
        style={active ? { backgroundColor: "var(--secondary)" } : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md py-2 text-sm transition-colors",
          indented ? "px-2" : "px-3",
          active
            ? "text-foreground font-medium"
            : "text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{m.nav[item.key]}</span>
      </Link>
    );
  };

  return (
    <nav className="space-y-4 p-3">
      {groups.map((g, gi) => (
        // 余白は padding で足す（space-y の margin と打ち消し合わないように）
        <div key={gi} className={cn("space-y-1", g.apart && "pt-6")}>
          {g.title ? (
            <>
              <button
                type="button"
                onClick={() => setOpenSystem((v) => !v)}
                aria-expanded={systemOpen}
                className="text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 transition-transform",
                    systemOpen && "rotate-90",
                  )}
                  aria-hidden
                />
                <Wrench className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{g.title}</span>
              </button>
              {systemOpen && (
                // 配下であることが見た目で分かるよう、左に一本線を引いて字下げする
                <div className="border-border ml-4 space-y-1 border-l pl-2">
                  {g.items.map((item) => renderItem(item, true))}
                </div>
              )}
            </>
          ) : (
            g.items.map((item) => renderItem(item, false))
          )}
        </div>
      ))}
    </nav>
  );
}
