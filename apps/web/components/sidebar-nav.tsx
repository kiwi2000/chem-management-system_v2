"use client";

import type { Messages, Permission } from "@chem/shared";
import {
  ArrowDownUp,
  BookOpen,
  Download,
  ChevronRight,
  FileText,
  FlaskConical,
  Globe,
  Home,
  Link2,
  Atom,
  Megaphone,
  MessageSquare,
  Package,
  Scale,
  Settings,
  Sigma,
  Tags,
  Upload,
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
  /** 押したときに開く画面。配下をまとめるだけの行では持たない */
  href?: string;
  /** 行頭のアイコン。文字を読まなくても見当が付くように置く */
  icon: LucideIcon;
  /** 辞書の nav ブロックから文言を引くためのキー */
  key: keyof Messages["nav"];
  /** この権限が無い人にはメニューを出さない（サーバー側でも別途弾く） */
  needs?: Permission;
  /** この接頭辞のパスでも選択中扱いにする（詳細画面など） */
  match?: string[];
  /** 配下に置く項目。字下げして親のすぐ下に並べる */
  children?: NavItem[];
}

/**
 * メニュー定義。
 * 未実装の画面もここに並べる（全体像が見えるようにするため）。
 * リンク先が未実装のうちは 404 になる。実装のたびに順次つながる。
 */
const ITEMS: NavItem[] = [
  { href: "/", key: "home", icon: Home },
  { href: "/substances", key: "substances", icon: FlaskConical, needs: "SUBSTANCE_VIEW" },
  { href: "/products", key: "products", icon: Package, needs: "PRODUCT_VIEW" },
  {
    // 中身は配下だけなので、この行自体は押しても何も開かない見出しにする
    key: "laws",
    icon: Scale,
    needs: "REGULATION_VIEW",
    children: [
      { href: "/regions", key: "regions", icon: Globe, needs: "REGULATION_VIEW" },
      {
        href: "/laws",
        key: "laws",
        icon: Scale,
        needs: "REGULATION_VIEW",
        match: ["/laws", "/categories"],
      },
      // 外から取り込むCASの対応データ。版・情報源・取込・差分をここで扱う
      // （自社で作ったぶんも、システムの外で管理するものなので同じ扱い）
      {
        href: "/external-db",
        key: "externalDb",
        icon: Link2,
        needs: "REGULATION_VIEW",
        match: ["/external-db"],
      },
      // 換算係数と元素は法規制の判定にしか使わないので、ここに置く
      { href: "/metal-factors", key: "metalFactors", icon: Sigma, needs: "REGULATION_VIEW" },
      { href: "/elements", key: "elements", icon: Atom, needs: "REGULATION_VIEW" },
    ],
  },
  {
    // 入れると出すで画面が分かれるので、まとめる見出しにして下にぶら下げる
    key: "importExport",
    icon: ArrowDownUp,
    needs: "DATA_EXPORT",
    children: [
      {
        href: "/import-export/import",
        key: "dataImport",
        icon: Upload,
        needs: "DATA_EXPORT",
      },
      {
        href: "/import-export/export",
        key: "dataExport",
        icon: Download,
        needs: "DATA_EXPORT",
      },
    ],
  },
  { href: "/doc-templates", key: "docTemplates", icon: FileText, needs: "DATA_EXPORT" },
  // お知らせを読むだけならホームで足りる。この画面は投稿・編集のためのものなので、
  // 投稿できる人にだけ見せる（他人の分を編集できる権限は投稿権限を含む）。
  // 日々の作業ではないので、業務の項目の後ろ、システムの手前に置く
  { href: "/news", key: "news", icon: Megaphone, needs: "NEWS_POST" },
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
  if (!item.href) return false;
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
  const groups: {
    title: string | null;
    items: NavItem[];
    /** 押して開け閉めする見出しにする（いまは「システム」だけ） */
    collapsible?: boolean;
    apart?: boolean;
  }[] = [
    { title: null, items: ITEMS.filter(allowed) },
    ...(adminItems.length > 0
      ? [{ title: m.nav.system, items: adminItems, collapsible: true }]
      : []),
    // 業務のメニューと地続きに見えないよう、上を大きめに空ける
    { title: m.nav.devOnly, items: DEV_ITEMS, apart: true },
  ];

  /**
   * まとまりの開閉。「システム」と「法規制」で使う。
   *
   * 押していないあいだは、配下の画面を開いていれば開いた状態にする
   * （選択中の項目が隠れてしまうため）。いちど押したらその選択を優先する。
   * そうしないと、配下の画面を見ているあいだ閉じられなくなる。
   */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const toggle = (key: string, fallback: boolean) =>
    setToggled((prev) => ({ ...prev, [key]: !(prev[key] ?? fallback) }));

  const inAdmin = adminItems.some((item) => isActive(pathname, item));
  const systemOpen = toggled.system ?? inAdmin;

  const renderItem = (item: NavItem, indented: boolean) => {
    const active = isActive(pathname, item);
    const Icon = item.icon;
    const inner = (
      <>
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{m.nav[item.key]}</span>
      </>
    );
    const shape = cn("flex items-center gap-2 rounded-md py-2 text-sm", indented ? "px-2" : "px-3");

    // 行き先を持たない行は、配下をまとめるための見出し。押せる見た目にしない
    if (!item.href) {
      return (
        <div key={item.key} className={cn(shape, "text-muted-foreground font-medium")}>
          {inner}
        </div>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        // 選択中の背景は CSS 変数を直接指定（ユーティリティが環境により効かないため）
        style={active ? { backgroundColor: "var(--secondary)" } : undefined}
        className={cn(
          shape,
          "transition-colors",
          active
            ? "text-foreground font-medium"
            : "text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground",
        )}
      >
        {inner}
      </Link>
    );
  };

  /**
   * 配下の入れ物。高さを測らずに開け閉めできるよう、grid の行を 0fr↔1fr で動かす。
   * 高さを指定しないので、項目が増えても動きが変わらない。
   */
  const branch = (open: boolean, children: NavItem[]) => (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-300 ease-out",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
      // 閉じているあいだは Tab でも入れないようにする
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">
        {/* 配下であることが見た目で分かるよう、左に一本線を引いて字下げする */}
        <div className="border-border ml-4 space-y-1 border-l pl-2">
          {children.map((c) => renderItem(c, true))}
        </div>
      </div>
    </div>
  );

  /** 開け閉めする見出しの行。「システム」と「法規制」で同じ形にそろえる */
  const groupHeading = (label: string, Icon: LucideIcon, open: boolean, onToggle: () => void) => (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors"
    >
      <ChevronRight
        className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        aria-hidden
      />
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );

  /** 親と、その配下の項目。配下を持つ見出しは押して開け閉めできる */
  const renderTree = (item: NavItem, indented: boolean) => {
    const children = (item.children ?? []).filter(allowed);
    if (children.length === 0) return renderItem(item, indented);

    // 業務でよく使うまとまりなので、初めは開いておく。押せば閉じられる
    const open = toggled[item.key] ?? true;
    return (
      <div key={item.href ?? item.key} className="space-y-1">
        {groupHeading(m.nav[item.key], item.icon, open, () => toggle(item.key, true))}
        {branch(open, children)}
      </div>
    );
  };

  return (
    <nav className="space-y-4 p-3">
      {groups.map((g, gi) => (
        // 余白は padding で足す（space-y の margin と打ち消し合わないように）
        <div key={gi} className={cn("space-y-1", g.apart && "pt-6")}>
          {g.title && !g.collapsible && (
            // 押しても何も起きない、ただの見出し
            <div className="text-muted-foreground px-3 pb-1 text-xs font-medium">{g.title}</div>
          )}
          {g.title && g.collapsible ? (
            <>
              {groupHeading(g.title, Wrench, systemOpen, () => toggle("system", inAdmin))}
              {branch(systemOpen, g.items)}
            </>
          ) : (
            g.items.map((item) => renderTree(item, false))
          )}
        </div>
      ))}
    </nav>
  );
}
