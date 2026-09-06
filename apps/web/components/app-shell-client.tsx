"use client";

import { ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen, Settings, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarFooter } from "@/components/sidebar-footer";
import { IdleCountdown } from "@/components/idle-countdown";
import { UserAvatar } from "@/components/user-avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { MeDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
  帯の上に置くアイコンのボタン。
  ghost の既定は「開いているあいだ薄い灰色（bg-muted）」で、色の付いた帯の上では
  白い四角が浮いて見えた。帯の字色を薄く混ぜた塗りにして、帯になじませる
*/
const HEADER_ICON_BUTTON =
  "text-header-foreground hover:bg-header-foreground/15 hover:text-header-foreground aria-expanded:bg-header-foreground/15 aria-expanded:text-header-foreground";

/** サイドバーの開閉状態は端末ごとに覚えておく */
const STORAGE_KEY = "chem.sidebar.open";
/** ヘッダーの開閉も同じように覚える。作業のあいだ閉じたままにしたい人がいる */
const HEADER_KEY = "chem.header.open";

interface Props {
  user: Pick<MeDto, "id" | "email" | "displayName" | "permissions" | "canEdit" | "isAdmin">;
  /** アバターの更新日時。変わると画像を取り直す */
  avatarVersion: number;
  /** いま判定に使っている法規制バージョン。null は「現在のバージョンが決まっていない」 */
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
  /*
    ヘッダーの開閉。**表を広く使いたいときに畳む。**
    畳んでいるあいだも戻す口は残す（消すと、メニューにも設定にも行けなくなる）
  */
  const [headerOpen, setHeaderOpen] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) setOpen(saved === "1");
    const savedHeader = window.localStorage.getItem(HEADER_KEY);
    if (savedHeader !== null) setHeaderOpen(savedHeader === "1");
  }, []);

  function toggleHeader(next: boolean) {
    setHeaderOpen(next);
    window.localStorage.setItem(HEADER_KEY, next ? "1" : "0");
  }

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
        いま判定に使っている法規制バージョン。**ヘッダーの札と同じものを、ここにも置く。**
        ヘッダーはコードだけで短く、こちらは名前まで出せる。
        メニューを開いている人は、この位置で確かめる癖が付いている
      */}
      {/*
        **どのバージョンで判定した結果を見ているか**は、
        画面に出ている数字の意味そのものを決める。
        いちばん下に置くぶん、色と大きさで目に留まるようにする。
        ログイン中の数と、管理者向けの「要再計算」も同じ欄に出す
      */}
      {version && <SidebarFooter version={version} isAdmin={user.isAdmin} />}
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
        {/*
          ヘッダーは畳める。**高さを変えて滑らせる**ので、
          畳むと下の中身がそのぶん上へ詰まる（隠すだけだと余白が残る）
        */}
        <div
          className={cn(
            "sticky top-0 z-30 overflow-hidden transition-[height] duration-200",
            headerOpen ? "h-14" : "h-0",
          )}
        >
          <header className="bg-header text-header-foreground flex h-14 items-center gap-3 border-b px-4">
            <Button
              variant="ghost"
              size="icon"
              className={HEADER_ICON_BUTTON}
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
              {/*
              いま判定に使っている法規制バージョン。**サイドバーの下からここへ移した。**
              下に置くと視線が最後に行くうえ、サイドバーを閉じると消えていた。
              どのバージョンで判定した結果を見ているかは、常に見えていてほしい。

              **ふだんは静かに、決まっていないときだけ強く出す。**
              いつも派手だと数日で見慣れて、結局は目に入らなくなる
            */}
              {version ? (
                <Badge
                  variant="secondary"
                  className="whitespace-nowrap"
                  title={version.nameJa ?? version.code}
                >
                  <span className="hidden md:inline">{m.shell.linkVersion} </span>
                  {version.code}
                </Badge>
              ) : (
                <Badge variant="destructive" className="whitespace-nowrap">
                  {m.shell.noLinkVersion}
                </Badge>
              )}
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
              {/* 畳む口。いちばん端に置く（押し間違えても実害が無い並び） */}
              <Button
                variant="ghost"
                size="icon"
                className={HEADER_ICON_BUTTON}
                title={m.shell.hideHeader}
                aria-label={m.shell.hideHeader}
                aria-expanded
                onClick={() => toggleHeader(false)}
              >
                <ChevronUp className="size-4" />
              </Button>
            </div>
          </header>
        </div>

        {/*
          畳んでいるときだけ出す、戻すための口。
          **画面の右上に浮かせる。**ヘッダーが無い状態でも必ず届く場所
        */}
        {!headerOpen && (
          <Button
            variant="outline"
            size="icon-sm"
            // 帯を畳んでいるあいだの出す口。帯と同じ色で塗り、白い四角が浮かないようにする
            className="bg-header/90 text-header-foreground border-header-foreground/20 hover:bg-header hover:text-header-foreground fixed top-1 right-2 z-40 backdrop-blur"
            title={m.shell.showHeader}
            aria-label={m.shell.showHeader}
            aria-expanded={false}
            onClick={() => toggleHeader(true)}
          >
            <ChevronDown className="size-4" />
          </Button>
        )}

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
