"use client";

import { Popover } from "@base-ui/react/popover";
import { Bell } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";

/**
 * ヘッダーに出す通知の 1 件。
 * **文言は呼ぶ側で作る。**ここは並べて見せるだけにして、種類が増えても触らずに済むようにする
 */
export interface Notice {
  key: string;
  text: string;
  /** 押したときの行き先。無ければ文だけ出す */
  href?: string;
  linkLabel?: string;
}

/**
 * ヘッダーの鈴（2026-09-17 指示）。
 *
 * **何も無いときは出さない。**いつも空の鈴が居ると、印が付いても目が留まらない。
 * 出ていること自体を合図にする。
 *
 * ここに出すのは、システムが出す「通知」。人が書く「お知らせ」（左メニュー）とは別のもの
 */
export function NoticeBell({ notices }: { notices: Notice[] }) {
  const { m } = useI18n();
  if (notices.length === 0) return null;

  return (
    <Popover.Root>
      <Popover.Trigger
        render={<Button variant="ghost" size="icon" className="relative" />}
        title={m.shell.notifications}
        aria-label={m.shell.notifications}
      >
        <Bell className="size-4" />
        {/* 付いていることが分かればよいので、件数は出さない */}
        <span className="absolute top-1 right-1 size-2 rounded-full bg-amber-400" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end">
          <Popover.Popup className="bg-popover text-popover-foreground ring-foreground/10 z-50 w-[min(92vw,22rem)] rounded-xl p-4 shadow-lg ring-1 outline-none">
            <p className="text-sm font-semibold">{m.shell.notifications}</p>
            <ul className="mt-2 space-y-2">
              {notices.map((n) => (
                <li key={n.key} className="text-sm">
                  {n.text}
                  {n.href && (
                    <>
                      {" "}
                      <Popover.Close
                        // 中身はリンク（<a>）なので、button として扱わせない
                        nativeButton={false}
                        render={
                          <Link href={n.href} className="text-primary underline underline-offset-2">
                            {n.linkLabel}
                          </Link>
                        }
                      />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
