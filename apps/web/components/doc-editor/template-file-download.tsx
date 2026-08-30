"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";

/**
 * Excel・Word の様式で作るときの画面。
 *
 * **紙面は見せない。**預かったファイルの形で出すので、
 * 画面に写しても本物と食い違う。落として、Word・Excel で開いてもらう
 */
export function TemplateFileDownload({
  href,
  title,
  ready,
  backHref,
}: {
  href: string;
  title: string;
  /** 様式にファイルが預けられているか */
  ready: boolean;
  backHref: string;
}) {
  const { m } = useI18n();
  return (
    <div className={PAGE_SHELL_STACKED}>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {ready ? (
        <>
          <p className="text-muted-foreground text-sm">{m.documents.fileHint}</p>
          <div className="flex items-center gap-2">
            <Button nativeButton={false} render={<a href={href} />}>
              <Download className="size-4" />
              {m.documents.fileDownload}
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href={backHref} />}>
              {m.common.back}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Alert>
            <AlertDescription>{m.documents.fileNone}</AlertDescription>
          </Alert>
          <div>
            <Button variant="outline" nativeButton={false} render={<Link href={backHref} />}>
              {m.common.back}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
