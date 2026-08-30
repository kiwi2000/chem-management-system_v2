"use client";

import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";

/**
 * ファイルの様式で作ったものを開いたときの知らせ。
 * **紙面は残していない。**落としたファイルが控えそのものになる
 */
export function SavedFileNote({ title, name }: { title: string; name: string }) {
  const { m } = useI18n();
  return (
    <div className={PAGE_SHELL_STACKED}>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Alert>
        <AlertDescription>
          {m.documents.fileSaved}
          <span className="mt-1 block font-mono text-xs">{name}</span>
        </AlertDescription>
      </Alert>
      <div>
        <Button variant="outline" nativeButton={false} render={<Link href="/documents" />}>
          {m.common.back}
        </Button>
      </div>
    </div>
  );
}
