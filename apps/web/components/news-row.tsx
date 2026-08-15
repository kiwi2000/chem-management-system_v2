"use client";

import { pickName } from "@chem/shared";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n-client";
import type { NewsDto } from "@/lib/types";

/**
 * ホームのお知らせ1件（2行）。
 *   1行目: タイトル                    所属 / 氏名 / 日時（右寄せ）
 *   2行目: 本文の冒頭（1行に収まるところで切る）
 * ダブルクリックで全文を開く。
 */
export function NewsRow({ item }: { item: NewsDto }) {
  const { locale, m } = useI18n();
  const [open, setOpen] = useState(false);

  const title = pickName(locale, item.titleJa, item.titleEn);
  const body = pickName(locale, item.bodyJa, item.bodyEn);
  const org = pickName(locale, item.authorOrgNameJa ?? "", item.authorOrgNameEn);
  const date = item.publishFrom ?? new Date(item.updatedAt).toLocaleDateString(locale);
  // 冒頭は1行に収めたいので、改行は空白に潰してから省略記号で切る
  const preview = body.replace(/\s+/g, " ").trim();

  return (
    <div
      className="hover:bg-muted/40 cursor-pointer rounded-md border px-3 py-2"
      onDoubleClick={() => setOpen((v) => !v)}
      title={open ? m.news.collapseHint : m.news.expandHint}
    >
      {/* 1行目。タイトルは伸びるが、右の情報とくっつかないよう1文字ぶん空けて省略する */}
      <div className="flex items-baseline gap-4">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {item.pinned && (
            <Badge variant="destructive" className="shrink-0 px-1 text-[10px]">
              {m.news.pinnedShort}
            </Badge>
          )}
          {item.status === "DRAFT" && (
            <Badge variant="outline" className="shrink-0 px-1 text-[10px]">
              {m.news.draft}
            </Badge>
          )}
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        <div className="text-muted-foreground shrink-0 text-right text-xs">
          {org && <span className="mr-2">{org}</span>}
          <span className="mr-2">{item.authorName}</span>
          <span>{date}</span>
        </div>
      </div>

      {/* 2行目。閉じているときは1行だけ、開いたら改行を活かして全文 */}
      <p
        className={
          open
            ? "text-muted-foreground mt-1 text-sm whitespace-pre-wrap"
            : "text-muted-foreground mt-1 truncate text-sm"
        }
      >
        {open ? body : preview}
      </p>
    </div>
  );
}
