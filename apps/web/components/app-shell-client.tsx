"use client";

import { ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen, Settings, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarFooter } from "@/components/sidebar-footer";
import { IdleCountdown } from "@/components/idle-countdown";
import { CardToggleRow } from "@/components/card-toggle-all";
import { NoticeBell, type Notice } from "@/components/notice-bell";
import { UserAvatar } from "@/components/user-avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
/**
 * メニューの開閉。**白いアイコンだけ**で、薄い四角の下地は付けない（2026-09-13 指示）。
 * 押せることはマウスを乗せたときの濃さで示す。幅はアイコンぶんに詰める
 */
const HEADER_ICON_BUTTON =
  "text-header-foreground hover:text-header-foreground aria-expanded:text-header-foreground h-8 w-5 rounded-none bg-transparent hover:bg-transparent aria-expanded:bg-transparent hover:opacity-70";

/**
 * 上の帯を開け閉めするタブ。**帯のすぐ外側、下の縁からぶら下げる**（2026-09-17 指示）。
 * 大きさは矢印がちょうど入るだけ、位置は帯の右端に寄せる（同日 指示）。
 * 白い紙の上に出るので、帯と同じ色で塗り、上辺だけ枠を描かない（帯と地続きに見せる）
 */
const HEADER_TAB =
  "bg-header text-header-foreground border-header-foreground/40 hover:bg-header/80 flex h-4 w-5 items-center justify-center border border-t-0";

/** サイドバーの開閉状態は端末ごとに覚えておく */
const STORAGE_KEY = "chem.sidebar.open";
/**
 * 残りがこの日数を切ったら、鈴だけでなく帯でも知らせる（2026-09-17 決定）。
 * 鈴は見落とせるので、締め出しが目前のときは目に入る形に切り替える
 */
const NOTICE_URGENT_DAYS = 3;

/** ヘッダーの開閉も同じように覚える。作業のあいだ閉じたままにしたい人がいる */
const HEADER_KEY = "chem.header.open";

interface Props {
  user: Pick<MeDto, "id" | "email" | "displayName" | "permissions" | "canEdit" | "isAdmin">;
  /** アバターの更新日時。変わると画像を取り直す */
  avatarVersion: number;
  /** いま判定に使っている法規制バージョン。null は「現在のバージョンが決まっていない」 */
  version: { code: string; nameJa: string | null } | null;
  /** パスワードの期限まであと何日か。予告を出さないときは null */
  passwordExpiresIn: number | null;
  children: ReactNode;
}

/**
 * アプリシェル（サイドバー＋トップバー）の見た目と開閉。
 * 広い画面ではサイドバーが本文を押し出し、狭い画面では本文の上に重ねて表示する。
 * どちらもトップバー左端の同じボタンで開閉する。
 */
export function AppShellClient({
  user,
  avatarVersion,
  version,
  passwordExpiresIn,
  children,
}: Props) {
  const { m } = useI18n();
  /*
    ヘッダーの鈴に出す通知。いまはパスワードの期限だけ。
    残りわずかになったら、鈴に加えて帯でも出す（見落とすと締め出しになるため）
  */
  const notices: Notice[] =
    passwordExpiresIn === null
      ? []
      : [
          {
            key: "passwordExpiry",
            text: m.shell.passwordExpiresIn(passwordExpiresIn),
            href: "/change-password",
            linkLabel: m.preferences.changePassword,
          },
        ];
  const urgent = passwordExpiresIn !== null && passwordExpiresIn <= NOTICE_URGENT_DAYS;
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
        {/* 名前はヘッダーの中央に出す。ここに出すと左ペインの幅で切れる。引き出しのときだけ */}
        <Link href="/" className="truncate text-base font-semibold md:hidden">
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
        いま判定に使っている法規制バージョン。**ヘッダーのバッジと同じものを、ここにも置く。**
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
        <div className="sticky top-0 z-30">
          <div
            className={cn(
              "overflow-hidden transition-[height] duration-200",
              headerOpen ? "h-14" : "h-0",
            )}
          >
            <header className="bg-header text-header-foreground flex h-14 items-center gap-2 border-b px-3">
              <Button
                variant="ghost"
                size="icon"
                className={HEADER_ICON_BUTTON}
                onClick={toggle}
                aria-label={open ? m.shell.closeMenu : m.shell.openMenu}
                aria-expanded={open}
              >
                {open ? (
                  <PanelLeftClose className="size-4" />
                ) : (
                  <PanelLeftOpen className="size-4" />
                )}
              </Button>
              {/* 名前は帯の左、開閉ボタンの隣。左ペインの頭に置くとペインの幅で切れた */}
              <Link href="/" className="min-w-0 truncate text-base font-semibold">
                {m.common.appName}
              </Link>
              <div className="ml-auto flex items-center gap-3">
                {/* 画面の枠をまとめて開く／閉じる。枠の無い画面では出ない */}
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
                {/* 通知の鈴。知らせることがあるときだけ、いちばん端に出る（2026-09-17 指示） */}
                <NoticeBell notices={notices} />
              </div>
            </header>
          </div>
          {/*
            開け閉めのタブ。**帯の並びから外し、帯のすぐ下に垂らす**（2026-09-17 指示）。
            並びの中に置くと横の場所を食い、通知の鈴を右端に置けない。
            畳むと帯の高さが 0 になり、このタブが画面の上端へ降りてくるので、
            **開ける口と閉じる口を 1 つで兼ねられる**（畳んだとき用の口は要らなくなった）
          */}
          <button
            type="button"
            className={cn(HEADER_TAB, "absolute top-full right-0 z-40")}
            title={headerOpen ? m.shell.hideHeader : m.shell.showHeader}
            aria-label={headerOpen ? m.shell.hideHeader : m.shell.showHeader}
            aria-expanded={headerOpen}
            onClick={() => toggleHeader(!headerOpen)}
          >
            {headerOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        </div>

        <main className="min-w-0 flex-1">
          {/*
            パスワードの期限が近いことの予告（2026-09-17 指示）。
            **どの画面にいても目に入る場所に出す。**期限の日に突然止められると、
            その日に問い合わせがまとまる。変えれば消える
          */}
          {urgent && (
            <div className="px-4 pt-4 lg:px-6 lg:pt-6">
              <Alert variant="destructive">
                <AlertDescription>
                  {m.shell.passwordExpiresIn(passwordExpiresIn ?? 0)}{" "}
                  <Link href="/change-password" className="underline underline-offset-2">
                    {m.preferences.changePassword}
                  </Link>
                </AlertDescription>
              </Alert>
            </div>
          )}
          <CardToggleRow />
          {children}
        </main>
      </div>
    </div>
  );
}
