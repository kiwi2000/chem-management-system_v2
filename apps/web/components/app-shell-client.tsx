"use client";

import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SidebarNav } from "@/components/sidebar-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { MeDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/** サイドバーの開閉状態は端末ごとに覚えておく */
const STORAGE_KEY = "chem.sidebar.open";

interface Props {
  user: Pick<MeDto, "email" | "displayName" | "permissions" | "canEdit" | "isAdmin">;
  children: ReactNode;
}

/**
 * アプリシェル（サイドバー＋トップバー）の見た目と開閉。
 * 広い画面ではサイドバーが本文を押し出し、狭い画面では本文の上に重ねて表示する。
 * どちらもトップバー左端の同じボタンで開閉する。
 */
export function AppShellClient({ user, children }: Props) {
  const { m } = useI18n();
  // 広い画面用（既定は開いた状態。localStorage に前回の状態を覚える）
  const [open, setOpen] = useState(true);
  // 狭い画面用のドロワー（既定は閉じた状態）
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) setOpen(saved === "1");
  }, []);

  function toggle() {
    // 狭い画面（md 未満）はドロワー、それ以上は押し出し式
    if (window.matchMedia("(max-width: 767px)").matches) {
      setDrawerOpen((v) => !v);
      return;
    }
    setOpen((v) => {
      window.localStorage.setItem(STORAGE_KEY, v ? "0" : "1");
      return !v;
    });
  }

  const sidebarBody = (
    <>
      <div className="flex h-14 items-center justify-between gap-2 border-b px-4">
        <Link href="/" className="truncate text-sm font-semibold">
          {m.common.appName}
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label={m.shell.closeMenu}
          className="md:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <X className="size-4" />
        </Button>
      </div>
      <SidebarNav permissions={user.permissions} onNavigate={() => setDrawerOpen(false)} />
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* 広い画面のサイドバー（開閉で本文の幅が変わる） */}
      <aside
        className={cn(
          // overflow-hidden が無いと中身の幅（w-56）が下限になって閉じきらない
          "hidden shrink-0 overflow-hidden transition-[width] duration-200 md:block",
          open ? "w-56 border-r" : "w-0",
        )}
        style={{ backgroundColor: "var(--background)" }}
        aria-hidden={!open}
      >
        <div className="w-56">{sidebarBody}</div>
      </aside>

      {/* 狭い画面のドロワー（本文に重ねる） */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label={m.shell.closeMenu}
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className="absolute inset-y-0 left-0 w-56 border-r shadow-lg"
            style={{ backgroundColor: "var(--background)" }}
          >
            {sidebarBody}
          </aside>
        </div>
      )}

      {/* 本体（トップバー＋コンテンツ） */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background flex h-14 items-center gap-3 border-b px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={open ? m.shell.closeMenu : m.shell.openMenu}
            aria-expanded={open}
          >
            {open ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </Button>
          {/* サイドバーが閉じているとタイトルが消えるのでここに出す */}
          <Link href="/" className={cn("truncate text-sm font-semibold", open && "md:hidden")}>
            {m.common.appName}
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-muted-foreground hidden text-sm sm:inline">
              {user.displayName ?? user.email}
            </span>
            {user.isAdmin && <Badge variant="secondary">{m.shell.admin}</Badge>}
            {!user.canEdit && <Badge variant="outline">{m.shell.readOnly}</Badge>}
            <LanguageSwitcher />
            <SignOutButton />
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
