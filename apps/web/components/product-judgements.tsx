"use client";

import { pickName } from "@chem/shared";
import { Check, TriangleAlert } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import type { ApiError, ProductJudgementDto } from "@/lib/types";

/**
 * その製品の法規制判定。
 *
 * 表にする。1行＝「当たった法文物質名」1件。
 * 何に当たったのかを横に並べて読めるほうが、追いやすいため。
 * 当たっていない区分は1行にまとめて出す（番号や物質名は空になる）。
 *
 * 判定（該当／非該当）と「人が見たかどうか」は**別の列**に出す。
 * 確認しても判定が変わらないことは普通にあるので、混ぜない。
 */
export function ProductJudgements({ productId, canEdit }: { productId: string; canEdit: boolean }) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<ProductJudgementDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** いま根拠を書いている区分。null なら誰も書いていない */
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  /** 非該当まで並べると長いので、既定では隠す */
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/products/${productId}/judgements`).catch(() => null);
    if (!res) return;
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setItems([]);
      return;
    }
    setItems(((await res.json()) as { items: ProductJudgementDto[] }).items);
  }, [productId, m]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(categoryId: string, verdict?: "APPLICABLE" | "NOT_APPLICABLE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/judgements/${categoryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, note: note.trim() || null }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setEditing(null);
      setNote("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (items === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.judgements.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{m.common.loading}</p>
        </CardContent>
      </Card>
    );
  }

  const applicable = items.filter((j) => j.verdict === "APPLICABLE");
  const review = items.filter((j) => j.needsReview);
  const shown = showAll ? items : applicable;

  /*
    1行＝当たった法文物質名1件。当たっていない区分は、
    区分そのものを1行として出す（番号や物質名は空）。
  */
  type Row = {
    j: ProductJudgementDto;
    /** 当たった法文物質名。当たっていない区分では null */
    h: ProductJudgementDto["hits"][number] | null;
    /** その区分の1行目か。2行目からは法令・区分を繰り返さない */
    first: boolean;
  };
  const rows: Row[] = shown.flatMap((j) =>
    j.hits.length > 0
      ? j.hits.map((h, i): Row => ({ j, h, first: i === 0 }))
      : [{ j, h: null, first: true }],
  );

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{m.judgements.title}</CardTitle>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {m.judgements.summary(applicable.length, items.length)}
          </span>
          {review.length > 0 && (
            <Badge variant="secondary" className="gap-1">
              <TriangleAlert className="size-3" />
              {m.judgements.reviewCount(review.length)}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{m.judgements.empty}</p>
        ) : (
          // 横に長い表なので、はみ出したら中だけ横に送る（画面全体を横に振らない）
          <div className="overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">{m.judgements.verdict}</TableHead>
                  <TableHead className="w-24">{m.judgements.law}</TableHead>
                  <TableHead className="w-40">{m.judgements.category}</TableHead>
                  <TableHead className="w-20">{m.judgements.number}</TableHead>
                  <TableHead>{m.judgements.statutoryName}</TableHead>
                  <TableHead className="w-32">{m.judgements.matchedCas}</TableHead>
                  <TableHead>{m.judgements.warning}</TableHead>
                  {canEdit && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ j, h, first }, i) => (
                  <TableRow key={`${j.categoryId}-${i}`}>
                    {/* 判定・法令・区分は、同じ区分の2行目からは繰り返さない */}
                    <TableCell className="align-top">
                      {first && (
                        <Badge variant={j.verdict === "APPLICABLE" ? "default" : "secondary"}>
                          {j.verdict === "APPLICABLE"
                            ? m.judgements.applicable
                            : m.judgements.notApplicable}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {first && pickName(locale, j.lawNameJa ?? j.lawNameOriginal, j.lawNameEn)}
                    </TableCell>
                    <TableCell className="text-muted-foreground align-top">
                      {first &&
                        pickName(
                          locale,
                          j.categoryNameJa ?? j.categoryNameOriginal,
                          j.categoryNameEn,
                        )}
                    </TableCell>
                    <TableCell className="align-top font-mono text-xs">
                      {h?.officialNumber ?? ""}
                    </TableCell>
                    <TableCell className="align-top">
                      {h ? (h.name ?? m.judgements.categoryItself) : ""}
                      {first && j.hitsWithheld && (
                        // 空なのか伏せたのかが分からないと、入っていないと読まれてしまう
                        <span className="text-muted-foreground text-xs">
                          {m.judgements.basisWithheld}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">{h && <Matched hit={h} m={m} />}</TableCell>
                    <TableCell className="align-top">
                      {first && j.needsReview && (
                        <div className="space-y-1">
                          <Badge variant="outline" className="text-destructive gap-1">
                            <TriangleAlert className="size-3" />
                            {m.judgements.needsReview}
                          </Badge>
                          {/* なぜ気になるのかを添える。理由の無い警告は読まれなくなる */}
                          <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
                            {j.reviewReasons.map((r) => (
                              <li key={r}>{reasonText(m, r)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {first && !j.needsReview && j.decidedByName && (
                        <p className="text-muted-foreground text-xs">
                          {m.judgements.decidedBy(
                            j.decidedByName,
                            j.decidedAt ? new Date(j.decidedAt).toLocaleString(locale) : "",
                          )}
                          {j.decidedNote && ` — ${j.decidedNote}`}
                        </p>
                      )}
                      {first && j.source === "USER" && (
                        <Badge variant="outline" className="mt-1">
                          {m.judgements.byUser}
                        </Badge>
                      )}
                    </TableCell>

                    {canEdit && (
                      <TableCell className="align-top">
                        {first &&
                          (editing === j.categoryId ? (
                            <div className="space-y-1">
                              <Input
                                className="h-8 w-56"
                                placeholder={m.judgements.notePlaceholder}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                              />
                              <div className="flex flex-wrap gap-1">
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => void decide(j.categoryId)}
                                >
                                  <Check className="mr-1 size-3.5" />
                                  {m.judgements.confirm}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    void decide(
                                      j.categoryId,
                                      j.verdict === "APPLICABLE" ? "NOT_APPLICABLE" : "APPLICABLE",
                                    )
                                  }
                                >
                                  {j.verdict === "APPLICABLE"
                                    ? m.judgements.changeToNot
                                    : m.judgements.changeToYes}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditing(null);
                                    setNote("");
                                  }}
                                >
                                  {m.common.cancel}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditing(j.categoryId);
                                setNote(j.decidedNote ?? "");
                              }}
                            >
                              {j.needsReview ? m.judgements.review : m.judgements.change}
                            </Button>
                          ))}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {items.length > applicable.length && (
          <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
            {showAll
              ? m.judgements.hideNotApplicable
              : m.judgements.showNotApplicable(items.length - applicable.length)}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

type M = ReturnType<typeof useI18n>["m"];

/**
 * 当たった CAS の出しかた。
 *
 * **合算したのか、個別に当たったのかが一目で分かるようにする。**
 * どちらも「複数のCASが並ぶ」ので、見分けが付かないと
 * 「足して超えた」のか「それぞれが超えた」のかを取り違える。
 *
 *   合算 … 縦に足し算の形で並べ、線の下に合計を出す
 *   個別 … それぞれを独立した行として並べ、合計は出さない
 */
function Matched({ hit, m }: { hit: ProductJudgementDto["hits"][number]; m: M }) {
  const aggregated = hit.total !== null;
  return (
    <div className="space-y-0.5">
      <Badge variant="outline" className="text-[10px]">
        {aggregated ? m.judgements.aggregated : m.judgements.individually}
      </Badge>
      {/* 表の中に表を入れない（読み上げの順が壊れる）。桁を揃えるだけなので格子で並べる */}
      <dl className="grid grid-cols-[auto_auto] gap-x-2 text-xs">
        {hit.contributions.map((c) => (
          <Fragment key={c.cas}>
            <dt className="font-mono">{c.cas}</dt>
            <dd className="text-muted-foreground text-right font-mono tabular-nums">{c.pct}%</dd>
          </Fragment>
        ))}
        {aggregated && (
          <>
            {/* 足した結果であることが分かるよう、線を引いて合計を置く */}
            <dt className="text-muted-foreground border-t pt-0.5">{m.judgements.sum}</dt>
            <dd className="border-t pt-0.5 text-right font-mono font-medium tabular-nums">
              {hit.total}%
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** なぜ確認が要るのか。次に何をすべきかが分かる言葉にする */
function reasonText(m: M, reason: string): string {
  const table: Record<string, string> = {
    missingFactor: m.judgements.reasonMissingFactor,
    unknownComposition: m.judgements.reasonUnknown,
    truncated: m.judgements.reasonTruncated,
    conditionalExclusion: m.judgements.reasonConditional,
    unfilledThreshold: m.judgements.reasonUnfilled,
  };
  return table[reason] ?? reason;
}
