"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
import type { ApiError, UserSummaryDto } from "@/lib/types";

export default function UsersPage() {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<UserSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setItems([]); // 「読み込み中」のまま止まって見えないようにする
      return;
    }
    setItems(((await res.json()) as { items: UserSummaryDto[] }).items);
  }, [m]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(u: UserSummaryDto) {
    if (!confirm(m.users.deleteConfirm(u.email))) return;
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    void load();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.users.title}</h1>
        <Button nativeButton={false} render={<Link href="/admin/users/new" />}>
          {m.common.create}
        </Button>
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
              <TableHead>{m.users.email}</TableHead>
              <TableHead>{m.users.displayName}</TableHead>
              <TableHead>{m.users.permissions}</TableHead>
              <TableHead>{m.users.lastLogin}</TableHead>
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
                  {m.users.empty}
                </TableCell>
              </TableRow>
            )}
            {items?.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono">
                  {u.email}
                  {!u.activeFlag && (
                    <Badge variant="outline" className="ml-2">
                      {m.users.inactive}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{u.displayName ?? ""}</TableCell>
                <TableCell>
                  {u.permissions.includes("ADMIN") ? (
                    <Badge variant="secondary">{m.shell.admin}</Badge>
                  ) : (
                    <span className="text-muted-foreground text-sm">
                      {m.users.permissionCount(u.permissions.length)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString(locale) : m.users.never}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/admin/users/${u.id}`} />}
                    >
                      {m.common.edit}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => void onDelete(u)}
                    >
                      {m.common.delete}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
