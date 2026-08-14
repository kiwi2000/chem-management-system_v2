"use client";

import { pickName } from "@chem/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { NewsCard } from "@/components/news-card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { NewsDto } from "@/lib/types";

/** ホーム本文に出す「掲載中のお知らせ」。分類ごとに見出しを付けて並べる */
export function HomeNews() {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<NewsDto[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/news?scope=home");
      if (res.ok) setItems(((await res.json()) as { items: NewsDto[] }).items);
      else setItems([]);
    })();
  }, []);

  /**
   * 分類ごとにまとめる。
   * APIが分類の表示順で並べて返すので、出てきた順にまとめれば見出しの順序もそのまま。
   */
  const sections = useMemo(() => {
    const out: { key: string; heading: string; items: NewsDto[] }[] = [];
    for (const n of items ?? []) {
      const key = n.groupId ?? "";
      const last = out[out.length - 1];
      if (last?.key === key) {
        last.items.push(n);
        continue;
      }
      const heading = n.groupId
        ? m.groups.newsHeading(pickName(locale, n.groupNameJa ?? "", n.groupNameEn))
        : m.groups.newsUngrouped;
      out.push({ key, heading, items: [n] });
    }
    return out;
  }, [items, m, locale]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{m.news.title}</h2>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/news" />}>
          {m.home.seeAllNews}
        </Button>
      </div>

      {items === null && <p className="text-muted-foreground text-sm">{m.common.loading}</p>}
      {items?.length === 0 && <p className="text-muted-foreground text-sm">{m.home.noNews}</p>}

      {sections.map((s) => (
        <div key={s.key} className="space-y-3">
          {/* 分類が1つも無い運用では見出しが1本だけ出る。邪魔にならない大きさにしてある */}
          <h3 className="text-muted-foreground border-b pb-1 text-sm font-medium">{s.heading}</h3>
          {s.items.map((n) => (
            <NewsCard key={n.id} item={n} />
          ))}
        </div>
      ))}
    </section>
  );
}
