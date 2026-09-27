"use client";

import type { Locale } from "@chem/shared";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { GhsImportForm } from "./ghs-import-form";
import { sdsMessages } from "../messages";

interface ReleaseDto {
  id: string;
  sourceCode: string;
  sourceNameJa: string;
  sourceNameEn: string;
  label: string;
  publishedOn: string;
  importedAt: string;
  addedCount: number;
  changedCount: number;
  unchangedCount: number;
  closedCount: number;
  issueCount: number;
}

/** GHS 分類データの画面: 取り込みの記録と、取り込みの入力欄（管理者だけ） */
export function GhsReleases({
  locale,
  isAdmin,
  sources,
}: {
  locale: Locale;
  isAdmin: boolean;
  sources: { code: string; name: string }[];
}) {
  const t = sdsMessages(locale).ghs;
  const [items, setItems] = useState<ReleaseDto[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/modules/sds/ghs/releases");
    if (!res.ok) {
      redirectIfUnauthorized(res);
      setItems([]);
      return;
    }
    setItems(((await res.json()) as { items: ReleaseDto[] }).items);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {isAdmin && (
        <Card collapsible={false}>
          <CardHeader>
            <CardTitle className="text-base">{t.import.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <GhsImportForm locale={locale} sources={sources} onApplied={() => void load()} />
          </CardContent>
        </Card>
      )}
      <Card collapsible={false}>
        <CardHeader>
          <CardTitle className="text-base">{t.releases}</CardTitle>
        </CardHeader>
        <CardContent>
          {items && items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.noReleases}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.source}</TableHead>
                  <TableHead>{t.columns.label}</TableHead>
                  <TableHead>{t.columns.publishedOn}</TableHead>
                  <TableHead>{t.columns.importedAt}</TableHead>
                  <TableHead className="text-right">{t.columns.added}</TableHead>
                  <TableHead className="text-right">{t.columns.changed}</TableHead>
                  <TableHead className="text-right">{t.columns.unchanged}</TableHead>
                  <TableHead className="text-right">{t.columns.issues}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(items ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{locale === "ja" ? r.sourceNameJa : r.sourceNameEn}</TableCell>
                    <TableCell>{r.label}</TableCell>
                    <TableCell>{r.publishedOn}</TableCell>
                    <TableCell>{new Date(r.importedAt).toLocaleString(locale)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.addedCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.changedCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.unchangedCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.issueCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
