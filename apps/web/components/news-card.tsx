"use client";

import { pickName } from "@chem/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n-client";
import type { NewsDto } from "@/lib/types";

/** お知らせ1件の表示。本文は改行をそのまま活かす */
export function NewsCard({ item }: { item: NewsDto }) {
  const { locale, m } = useI18n();
  const title = pickName(locale, item.titleJa, item.titleEn);
  const body = pickName(locale, item.bodyJa, item.bodyEn);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {item.pinned && <Badge variant="destructive">{m.news.pinnedShort}</Badge>}
          {item.status === "DRAFT" && <Badge variant="outline">{m.news.draft}</Badge>}
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <div className="text-muted-foreground text-xs">
          {item.publishFrom ?? new Date(item.updatedAt).toLocaleDateString(locale)} ・{" "}
          {item.authorName}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm whitespace-pre-wrap">{body}</p>
      </CardContent>
    </Card>
  );
}
