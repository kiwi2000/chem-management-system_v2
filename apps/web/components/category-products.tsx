"use client";

import { pickName } from "@chem/shared";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useResizableColumns } from "@/components/data-table/resizable-columns";
import { MatchedCells, OneLine, reasonText, type M } from "@/components/product-judgements";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, JudgementHitDto, MatchedProductDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * この規制区分に当たる製品（逆引き）。
 *
 * 製品の詳細と向きが逆で、**1つの区分に対して製品が並ぶ**。
 * 「この法律に引っかかるものはどれか」を、製品を1つずつ開かずに知るためのもの。
 *
 * 1行＝当たった法文物質名1件。同じ製品で複数当たれば、その数だけ行が続く。
 * 製品名は2行目からは繰り返さない（同じ製品の続きだと目で追えるように）。
 *
 * 並ぶのは「該当したもの」と「引っかからないと言い切れていないもの」の2種類。
 * **後者は非該当だが、判断できなかったという意味なので必ず出す。**
 * どちらなのかは左端の判定の列で見分ける。
 */
/**
 * 列の並びと既定の幅。判定表（`product-judgements`）と同じ並びにそろえてある。
 * 向きは逆でも、見るものは同じなので、列の位置が変わると目が迷う。
 */
/** 組成の表と同じ枠線・余白 */
const CELL = "border-r px-2 py-1 last:border-r-0";

const HEADS: {
  key: string;
  width: number;
  label: (m: M) => string;
  className?: string;
}[] = [
  { key: "verdict", width: 64, label: (m) => m.judgements.verdict },
  { key: "code", width: 96, label: (m) => m.products.code },
  { key: "nameJa", width: 224, label: (m) => m.products.nameJa },
  { key: "number", width: 56, label: (m) => m.judgements.number },
  { key: "statutoryName", width: 288, label: (m) => m.judgements.statutoryName },
  // 含有率とCASは2つで1組。並びを入れ替えないこと
  { key: "content", width: 72, label: (m) => m.judgements.content, className: "text-right" },
  { key: "matchedCas", width: 96, label: (m) => m.judgements.matchedCas },
  { key: "warning", width: 256, label: (m) => m.judgements.warning },
];

export function CategoryProducts({ categoryId }: { categoryId: string }) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<MatchedProductDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 列幅は一覧と同じ規則
  // 幅を詰めない。判定表と同じ規則にそろえる
  const cols = useResizableColumns("chem.table.categoryProducts", HEADS, {
    shrinkToFit: false,
    rowLabel: m.table.resizeRows,
  });

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    const res = await fetch(`/api/regulation-categories/${categoryId}/products`).catch(() => null);
    if (!res) return;
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setItems([]);
      return;
    }
    setItems(((await res.json()) as { items: MatchedProductDto[] }).items);
  }, [categoryId, m]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (items === null) return null;
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{m.judgements.noMatchedProducts}</p>;
  }

  /** 1行＝法文物質名1件。根拠が無い（伏せられた）製品も1行は出す */
  type Row = { p: MatchedProductDto; h: JudgementHitDto | null; first: boolean };
  const rows = items.flatMap<Row>((p) =>
    p.hits.length === 0
      ? [{ p, h: null, first: true }]
      : p.hits.map((h, i) => ({ p, h, first: i === 0 })),
  );

  return (
    // 幅は列の側で決める。製品ごとに列の位置がずれると見比べられない
    <div ref={cols.scrollerRef} className="overflow-x-auto" {...cols.rowProps}>
      {/* 切れているセルにマウスを置いたとき、中身を全部出す吹き出し */}
      {cols.peek}
      <Table {...cols.tableProps} className={cn("table-fixed", cols.tableProps.className)}>
        <colgroup>{cols.cols()}</colgroup>
        <TableHeader className="table-head-solid text-table-head-foreground">
          <TableRow>
            {HEADS.map(({ key, label, className }, i) => (
              <TableHead key={key} className={cn("relative", className)}>
                {/* 行の高さのつまみは、いちばん左の見出しに1つだけ */}
                {i === 0 && cols.rowHandle()}
                {label(m)}
                {cols.handle(key, `${label(m)} ${m.table.resize}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ p, h, first }, i) => (
            <TableRow key={`${p.productId}-${i}`}>
              {/* 判定・コード・名前は、同じ製品の2行目からは繰り返さない */}
              <TableCell className={cn(CELL, "align-top")}>
                {first && (
                  <Badge variant={p.verdict === "APPLICABLE" ? "default" : "secondary"}>
                    {p.verdict === "APPLICABLE"
                      ? m.judgements.applicable
                      : m.judgements.notApplicable}
                  </Badge>
                )}
              </TableCell>
              <TableCell className={cn(CELL, "align-top font-mono text-xs")}>
                {first && (
                  <Link href={`/products/${p.productId}`} className="hover:underline">
                    {p.code}
                  </Link>
                )}
              </TableCell>
              <TableCell className={cn(CELL, "align-top")}>
                {first && (
                  <Fragment>
                    <OneLine text={pickName(locale, p.nameJa, p.nameEn)} />
                    {/* 廃番のものも出す。過去の出荷ぶんの問い合わせに答えるため */}
                    {p.status === "DISCONTINUED" && (
                      <Badge variant="secondary" className="ml-2">
                        {m.products.statusDiscontinued}
                      </Badge>
                    )}
                  </Fragment>
                )}
              </TableCell>
              <TableCell className={cn(CELL, "align-top font-mono text-xs")}>
                {h?.officialNumber ?? ""}
              </TableCell>
              <TableCell className={cn(CELL, "align-top")}>
                {h && <OneLine text={h.name ?? m.judgements.categoryItself} />}
                {first && p.hitsWithheld && (
                  // 空なのか伏せたのかが分からないと、入っていないと読まれてしまう
                  <span className="text-muted-foreground text-xs">
                    {m.judgements.basisWithheld}
                  </span>
                )}
              </TableCell>
              {h ? <MatchedCells hit={h} m={m} cellClass={CELL} /> : <TableCell colSpan={2} />}
              <TableCell className={cn(CELL, "align-top")}>
                {first && p.needsReview && (
                  <div className="space-y-1">
                    <Badge variant="outline" className="text-destructive gap-1">
                      <TriangleAlert className="size-3" />
                      {m.judgements.needsReview}
                    </Badge>
                    <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
                      {p.reviewReasons.map((r) => (
                        <li key={r}>{reasonText(m, r)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {first && p.source === "USER" && (
                  <Badge variant="outline" className="mt-1">
                    {m.judgements.byUser}
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
