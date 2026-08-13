"use client";

import { pickName } from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, SubstanceListItemDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";

export default function SubstancesPage() {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("SUBSTANCE_EDIT");

  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse<SubstanceListItemDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (query: string, pageNum: number) => {
      setError(null);
      const params = new URLSearchParams({ page: String(pageNum) });
      if (query) params.set("q", query);
      const res = await fetch(`/api/substances?${params}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
        setData({ items: [], total: 0, page: pageNum, pageSize: 50 });
        return;
      }
      setData((await res.json()) as ListResponse<SubstanceListItemDto>);
    },
    [m],
  );

  useEffect(() => {
    void load(submittedQ, page);
  }, [load, submittedQ, page]);

  async function onDelete(s: SubstanceListItemDto) {
    if (!confirm(m.substances.deleteConfirm(`${s.code}: ${pickName(locale, s.nameJa, s.nameEn)}`)))
      return;
    const res = await fetch(`/api/substances/${s.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    void load(submittedQ, page);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.substances.title}</h1>
        {editable && (
          <Button nativeButton={false} render={<Link href="/substances/new" />}>
            {m.common.create}
          </Button>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSubmittedQ(q);
        }}
      >
        <Input
          placeholder={m.substances.searchPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
        />
        <Button type="submit" variant="secondary">
          {m.common.search}
        </Button>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="bg-background overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{m.substances.code}</TableHead>
              <TableHead>{m.substances.casNumber}</TableHead>
              <TableHead>{m.substances.mainName}</TableHead>
              <TableHead className="w-24">{m.substances.status}</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data === null && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  {m.common.loading}
                </TableCell>
              </TableRow>
            )}
            {data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  {m.substances.empty}
                </TableCell>
              </TableRow>
            )}
            {data?.items.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono">{s.code}</TableCell>
                <TableCell className="font-mono">{s.casNumber ?? "—"}</TableCell>
                <TableCell>
                  {pickName(locale, s.nameJa, s.nameEn)}
                  {s.subNameCount > 0 && (
                    <span className="text-muted-foreground ml-2 text-xs">+{s.subNameCount}</span>
                  )}
                </TableCell>
                <TableCell>
                  {s.status === "DISCONTINUED" && (
                    <Badge variant="outline">{m.substances.statusDiscontinued}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/substances/${s.id}`} />}
                    >
                      {editable ? m.common.edit : m.common.view}
                    </Button>
                    {editable && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void onDelete(s)}
                      >
                        {m.common.delete}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data && (
        <div className="text-muted-foreground flex items-center justify-between text-sm">
          <span>{m.common.totalCount(data.total)}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {m.common.prev}
            </Button>
            <span>{m.common.pageOf(page, totalPages)}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              {m.common.next}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
