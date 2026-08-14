"use client";

import { pickName } from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RowActions } from "@/components/data-table/row-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, MeDto, NewsDto } from "@/lib/types";

export default function NewsListPage() {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<NewsDto[] | null>(null);
  const [canPost, setCanPost] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [res, meRes] = await Promise.all([fetch("/api/news"), fetch("/api/me")]);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setItems([]);
      return;
    }
    setItems(((await res.json()) as { items: NewsDto[] }).items);
    if (meRes.ok) {
      const me = (await meRes.json()) as MeDto;
      setCanPost(me.permissions.includes("NEWS_POST"));
    }
  }, [m]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(n: NewsDto) {
    if (!confirm(m.news.deleteConfirm(pickName(locale, n.titleJa, n.titleEn)))) return;
    const res = await fetch(`/api/news/${n.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    void load();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.news.title}</h1>
        {canPost && (
          <Button nativeButton={false} render={<Link href="/news/new" />}>
            {m.common.create}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="bg-background rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{m.news.titleJa}</TableHead>
              <TableHead className="w-28">{m.news.status}</TableHead>
              <TableHead className="w-44">{m.news.publishFrom}</TableHead>
              <TableHead className="w-40">{m.news.author}</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items === null && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  {m.common.loading}
                </TableCell>
              </TableRow>
            )}
            {items?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  {m.news.empty}
                </TableCell>
              </TableRow>
            )}
            {items?.map((n) => (
              <TableRow key={n.id}>
                <TableCell>
                  {n.pinned && (
                    <Badge variant="destructive" className="mr-2">
                      {m.news.pinnedShort}
                    </Badge>
                  )}
                  {pickName(locale, n.titleJa, n.titleEn)}
                </TableCell>
                <TableCell>
                  <Badge variant={n.status === "PUBLISHED" ? "secondary" : "outline"}>
                    {n.status === "PUBLISHED" ? m.news.published : m.news.draft}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {n.publishFrom ?? "—"}
                  {n.publishUntil ? ` 〜 ${n.publishUntil}` : ""}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{n.authorName}</TableCell>
                <TableCell>
                  <RowActions
                    detailHref={`/news/${n.id}`}
                    onDelete={n.editable ? () => void onDelete(n) : undefined}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
