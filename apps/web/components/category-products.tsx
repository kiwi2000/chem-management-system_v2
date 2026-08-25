"use client";

import { pickName } from "@chem/shared";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { MatchedCells, OneLine, reasonText } from "@/components/product-judgements";
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

/**
 * この規制区分に当たる製品（逆引き）。
 *
 * 製品の詳細と向きが逆で、**1つの区分に対して製品が並ぶ**。
 * 「この法令に引っかかるものはどれか」を、製品を1つずつ開かずに知るためのもの。
 *
 * 1行＝当たった法文物質名1件。同じ製品で複数当たれば、その数だけ行が続く。
 * 製品名は2行目からは繰り返さない（同じ製品の続きだと目で追えるように）。
 *
 * 並ぶのは「該当したもの」と「引っかからないと言い切れていないもの」の2種類。
 * **後者は非該当だが、判断できなかったという意味なので必ず出す。**
 * どちらなのかは左端の判定の列で見分ける。
 */
export function CategoryProducts({ categoryId }: { categoryId: string }) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<MatchedProductDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">{m.judgements.verdict}</TableHead>
          <TableHead className="w-28">{m.products.code}</TableHead>
          <TableHead className="w-56">{m.products.nameJa}</TableHead>
          <TableHead className="w-14">{m.judgements.number}</TableHead>
          <TableHead className="w-72">{m.judgements.statutoryName}</TableHead>
          {/* 含有率とCASは2つで1組。並びを入れ替えないこと */}
          <TableHead className="w-24 text-right">{m.judgements.content}</TableHead>
          <TableHead className="w-28">{m.judgements.matchedCas}</TableHead>
          <TableHead className="w-64">{m.judgements.warning}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ p, h, first }, i) => (
          <TableRow key={`${p.productId}-${i}`}>
            {/* 判定・コード・名前は、同じ製品の2行目からは繰り返さない */}
            <TableCell className="align-top">
              {first && (
                <Badge variant={p.verdict === "APPLICABLE" ? "default" : "secondary"}>
                  {p.verdict === "APPLICABLE"
                    ? m.judgements.applicable
                    : m.judgements.notApplicable}
                </Badge>
              )}
            </TableCell>
            <TableCell className="align-top font-mono text-xs">
              {first && (
                <Link href={`/products/${p.productId}`} className="hover:underline">
                  {p.code}
                </Link>
              )}
            </TableCell>
            <TableCell className="align-top">
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
            <TableCell className="align-top font-mono text-xs">{h?.officialNumber ?? ""}</TableCell>
            <TableCell className="align-top">
              {h && <OneLine text={h.name ?? m.judgements.categoryItself} />}
              {first && p.hitsWithheld && (
                // 空なのか伏せたのかが分からないと、入っていないと読まれてしまう
                <span className="text-muted-foreground text-xs">{m.judgements.basisWithheld}</span>
              )}
            </TableCell>
            {h ? <MatchedCells hit={h} m={m} /> : <TableCell colSpan={2} />}
            <TableCell className="align-top">
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
  );
}
