"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NewsCard } from "@/components/news-card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { NewsDto } from "@/lib/types";

/** ホーム本文に出す「掲載中のお知らせ」 */
export function HomeNews() {
  const { m } = useI18n();
  const [items, setItems] = useState<NewsDto[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/news?scope=home");
      if (res.ok) setItems(((await res.json()) as { items: NewsDto[] }).items);
      else setItems([]);
    })();
  }, []);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{m.news.title}</h2>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/news" />}>
          {m.home.seeAllNews}
        </Button>
      </div>

      {items === null && <p className="text-muted-foreground text-sm">{m.common.loading}</p>}
      {items?.length === 0 && <p className="text-muted-foreground text-sm">{m.home.noNews}</p>}
      <div className="space-y-3">
        {items?.map((n) => (
          <NewsCard key={n.id} item={n} />
        ))}
      </div>
    </section>
  );
}
