"use client";

import { PanelLeftClose, PanelLeftOpen, Settings, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { SidebarNav } from "@/components/sidebar-nav";
import { IdleCountdown } from "@/components/idle-countdown";
import { UserAvatar } from "@/components/user-avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { MeDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/** サイドバーの開閉状態は端末ごとに覚えておく */
const STORAGE_KEY = "chem.sidebar.open";

interface Props {
  user: Pick<MeDto, "id" | "email" | "displayName" | "permissions" | "canEdit" | "isAdmin">;
  /** アバターの更新日時。変わると画像を取り直す */
  avatarVersion: number;
  /** いま判定に使っている法規制の版。無ければ出さない */
  version: { code: string; nameJa: string | null } | null;
  children: ReactNode;
}

/**
 * アプリシェル（サイドバー＋トップバー）の見た目と開閉。
 * 広い画面ではサイドバーが本文を押し出し、狭い画面では本文の上に重ねて表示する。
 * どちらもトップバー左端の同じボタンで開閉する。
 */
export function AppShellClient({ user, avatarVersion, version, children }: Props) {
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
      {/* 設定で濃くできる。既定は左ペインと同じ色なので見た目は変わらない */}
      <div className="bg-sidebar-header text-sidebar-header-foreground flex h-14 items-center justify-between gap-2 border-b px-4">
        <Link href="/" className="truncate text-base font-semibold">
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
      {/*
        いま判定に使っている法規制の版。**操作ではないので、いちばん下に置く。**
        「どの版で判定した結果を見ているか」が常に分かるようにするためのもの
      */}
      {version && (
        <div className="text-muted-foreground mt-auto border-t px-4 py-2 text-xs">
          <div>{m.shell.linkVersion}</div>
          <div className="truncate font-medium">
            {version.code}
            {version.nameJa && ` ${version.nameJa}`}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* 広い画面のサイドバー（開閉で本文の幅が変わる） */}
      <aside
        className={cn(
          // overflow-hidden が無いと中身の幅（w-56）が下限になって閉じきらない
          "hidden shrink-0 overflow-hidden transition-[width] duration-200 md:block",
          // 本文だけをスクロールさせ、メニューは画面に貼り付ける
          "sticky top-0 h-screen self-start",
          open ? "w-56 border-r" : "w-0",
        )}
        style={{ backgroundColor: "var(--background)" }}
        aria-hidden={!open}
      >
        <div className="flex h-full w-56 flex-col">{sidebarBody}</div>
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
            className="absolute inset-y-0 left-0 flex w-56 flex-col border-r shadow-lg"
            style={{ backgroundColor: "var(--background)" }}
          >
            {sidebarBody}
          </aside>
        </div>
      )}

      {/* 本体（トップバー＋コンテンツ） */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          設定によっては色が敷かれる。中の文字色は header-foreground に従わせる。
          スクロールしても隠れないよう画面上端に固定する（ドロワーの z-40 より下）。
        */}
        <header className="bg-header text-header-foreground sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4">
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
          <Link href="/" className={cn("truncate text-base font-semibold", open && "md:hidden")}>
            {m.common.appName}
          </Link>
          <div className="ml-auto flex items-center gap-3">
            {/* 自動ログアウトが近いときだけ出る。ふだんは何も無い */}
            <IdleCountdown />
            <Link href="/preferences" title={user.displayName ?? user.email}>
              <UserAvatar
                userId={user.id}
                name={user.displayName ?? user.email}
                size={28}
                version={avatarVersion}
              />
            </Link>
            {/* 濃いヘッダーでも読めるよう、色を変えず薄くするだけにする */}
            <span className="hidden text-sm opacity-75 sm:inline">
              {user.displayName ?? user.email}
            </span>
            {user.isAdmin && <Badge variant="secondary">{m.shell.admin}</Badge>}
            {/* 枠線だけのバッジは、濃いヘッダーでも読めるよう文字色を継承させる */}
            {!user.canEdit && (
              <Badge variant="outline" className="border-current text-inherit">
                {m.shell.readOnly}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              title={m.preferences.title}
              aria-label={m.preferences.title}
              nativeButton={false}
              render={<Link href="/preferences" />}
            >
              <Settings className="size-4" />
            </Button>
            <SignOutButton />
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
