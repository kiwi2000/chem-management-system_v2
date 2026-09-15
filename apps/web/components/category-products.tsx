"use client";

import { pickName } from "@chem/shared";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useResizableColumns } from "@/components/data-table/resizable-columns";
import {
  MatchedCells,
  OneLine,
  reasonText,
  unitName,
  type M,
} from "@/components/product-judgements";
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
import type { ApiError, MatchedProductDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ResizableBox } from "@/components/data-table/resizable-box";

/**
 * この規制区分に当たる製品（逆引き）。
 *
 * 製品の詳細と向きが逆で、**1つの区分に対して製品が並ぶ**。
 * 「この法律に引っかかるものはどれか」を、製品を1つずつ開かずに知るためのもの。
 *
 * 1行＝製品 × 判定の単位（法文物質名。区分でまとめる区分は区分そのもの）。
 * 同じ製品で複数当たれば、その数だけ行が続く。
 * 製品名は2行目からは繰り返さない（同じ製品の続きだと目で追えるように）。
 * 該非と確認の要否は行（判定の単位）ごと（2026-09-15 決定）。
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

  /** 1行＝判定の単位。製品名は同じ製品の最初の行にだけ出す */
  const rows = items.map((p, i) => ({
    p,
    h: p.hits[0] ?? null,
    first: i === 0 || items[i - 1]!.productId !== p.productId,
  }));

  return (
    // 幅は列の側で決める。製品ごとに列の位置がずれると見比べられない
    <ResizableBox
      storageKey="chem.box.categoryProducts"
      scrollerRef={cols.scrollerRef}
      {...cols.rowProps}
    >
      {/* 切れているセルにマウスを置いたとき、中身を全部出す吹き出し */}
      {cols.peek}
      {cols.stickyBar}
      <Table
        {...cols.tableProps}
        className={cn("table-fixed", cols.tableProps.className)}
        containerClassName="overflow-visible"
      >
        <colgroup>{cols.cols()}</colgroup>
        <TableHeader className="table-head-solid text-table-head-foreground sticky top-0 z-10 [&_th]:text-inherit">
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
              {/* 判定は行（判定の単位）ごと。コード・名前は、同じ製品の2行目からは繰り返さない */}
              <TableCell className={cn(CELL, "align-top")}>
                <Badge variant={p.verdict === "APPLICABLE" ? "default" : "secondary"}>
                  {p.verdict === "APPLICABLE"
                    ? m.judgements.applicable
                    : m.judgements.notApplicable}
                </Badge>
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
                {p.officialNumber ?? ""}
              </TableCell>
              <TableCell className={cn(CELL, "align-top")}>
                {/* 根拠を伏せた相手には法文物質名も出ない（製品ごとに 1 行にまとまっている） */}
                {(p.statutoryName !== null || p.hitsWithheld === false) && (
                  <OneLine text={unitName(p, locale, m)} />
                )}
                {p.notYetEffective && p.effectiveFrom && (
                  <Badge variant="outline" className="mt-1">
                    {m.judgements.notYetEffective(p.effectiveFrom)}
                  </Badge>
                )}
                {p.hitsWithheld && (
                  // 空なのか伏せたのかが分からないと、入っていないと読まれてしまう
                  <span className="text-muted-foreground text-xs">
                    {m.judgements.basisWithheld}
                  </span>
                )}
              </TableCell>
              {h ? <MatchedCells hit={h} m={m} cellClass={CELL} /> : <TableCell colSpan={2} />}
              <TableCell className={cn(CELL, "align-top")}>
                {p.needsReview && (
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
                {p.source === "USER" && (
                  <Badge variant="outline" className="mt-1">
                    {m.judgements.byUser}
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ResizableBox>
  );
}
