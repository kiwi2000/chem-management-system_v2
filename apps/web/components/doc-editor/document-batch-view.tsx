"use client";

import { Printer } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BATCH_MAX } from "@/lib/doc-batch";
import type { RenderedDocument } from "@/lib/doc-render";
import { useI18n } from "@/lib/i18n-client";
import { DocumentSheet } from "@/components/doc-editor/document-view";

/**
 * まとめて作った帳票を、続けて出す。
 *
 * **帳票と帳票のあいだで必ず改ページする。**続けて刷ると、
 * 前の帳票の途中から次が始まってしまい、配れる形にならない。
 */
export function DocumentBatchView({
  docs,
  title,
  backHref,
  missed,
  tooMany,
}: {
  docs: { code: string; doc: RenderedDocument }[];
  title: string;
  backHref: string;
  /** 見る権限が無いなどで作れなかった件数 */
  missed: number;
  /** 上限を超えて頼まれたときの上限値。0 なら超えていない */
  tooMany: number;
}) {
  const { m } = useI18n();

  return (
    <div className="w-full">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 p-3 lg:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={backHref} className="text-muted-foreground text-xs underline">
            {title}
          </Link>
          <span className="text-sm">{m.documents.batchCount(docs.length)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground text-xs">{m.documents.printHint}</span>
          <Button size="sm" disabled={docs.length === 0} onClick={() => window.print()}>
            <Printer className="size-4" />
            {m.documents.print}
          </Button>
        </div>
      </div>

      {(tooMany > 0 || missed > 0 || docs.length === 0) && (
        <div className="no-print space-y-2 px-3 lg:px-4">
          {tooMany > 0 && (
            <Alert>
              <AlertDescription>{m.documents.batchTooMany(BATCH_MAX)}</AlertDescription>
            </Alert>
          )}
          {missed > 0 && (
            <Alert>
              <AlertDescription>{m.documents.batchMissed(missed)}</AlertDescription>
            </Alert>
          )}
          {docs.length === 0 && (
            <Alert>
              <AlertDescription>{m.documents.batchEmpty}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {docs.map((d, i) => (
        <div
          key={i}
          // 最後の1枚のあとで改ページすると、白い紙が1枚余分に出る
          style={i < docs.length - 1 ? { pageBreakAfter: "always", breakAfter: "page" } : undefined}
        >
          <DocumentSheet doc={d.doc} />
        </div>
      ))}
    </div>
  );
}
