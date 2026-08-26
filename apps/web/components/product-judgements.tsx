"use client";

import { pickName } from "@chem/shared";
import { Check, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { useResizableColumns } from "@/components/data-table/resizable-columns";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import type { ApiError, JudgementHitDto, ProductJudgementDto } from "@/lib/types";

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
export type M = ReturnType<typeof useI18n>["m"];

/**
 * 列の並びと既定の幅。**見出しと幅を1か所に持つ。**
 * 別々に書くと、列を足したときに幅だけ古いまま残って気づけない。
 *
 * 含有率と該当CASは2つで1組。**間に別の列を挟まないこと**（合算かどうかが読めなくなる）。
 */
const HEADS: { key: string; width: number; label: (m: M) => string; className?: string }[] = [
  { key: "verdict", width: 64, label: (m) => m.judgements.verdict },
  { key: "law", width: 80, label: (m) => m.judgements.law },
  { key: "category", width: 144, label: (m) => m.judgements.category },
  { key: "number", width: 56, label: (m) => m.judgements.number },
  { key: "statutoryName", width: 288, label: (m) => m.judgements.statutoryName },
  { key: "content", width: 72, label: (m) => m.judgements.content, className: "text-right" },
  { key: "matchedCas", width: 96, label: (m) => m.judgements.matchedCas },
  { key: "warning", width: 256, label: (m) => m.judgements.warning },
];

/** 操作の列。編集できる人にだけ出るので、列の並びとは別に持つ */
const ACTION_COLUMN = { key: "actions", width: 96 };

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
  // 列幅は一覧と同じ規則。操作の列は、出るときだけ幅を数に入れる
  const cols = useResizableColumns(
    "chem.table.productJudgements",
    [...HEADS, ...(canEdit ? [ACTION_COLUMN] : [])],
    // 幅を詰めない。詰めると製品ごと・画面幅ごとに列の位置が動いて見比べられない
    { shrinkToFit: false },
  );

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
          <div ref={cols.scrollerRef} className="overflow-x-auto">
            {/*
              table-fixed にして、幅を列の側で決める。
              自動幅だと、法文物質名の長いものが1件あるだけで表全体の形が変わり、
              製品ごとに列の位置がずれて見比べられなくなる。
              幅は一覧と同じ規則で、見出しの右端をつまんで変えられる。
            */}
            <Table className="table-fixed text-sm" style={{ minWidth: cols.minTableWidth }}>
              <colgroup>{cols.cols()}</colgroup>
              <TableHeader>
                <TableRow>
                  {HEADS.map(({ key, label, className }) => (
                    <TableHead key={key} className={cn("relative", className)}>
                      {label(m)}
                      {cols.handle(key, `${label(m)} ${m.table.resize}`)}
                    </TableHead>
                  ))}
                  {canEdit && (
                    <TableHead className="relative">
                      {cols.handle("actions", m.table.resize)}
                    </TableHead>
                  )}
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
                      {first && (
                        <OneLine
                          text={pickName(
                            locale,
                            j.categoryNameJa ?? j.categoryNameOriginal,
                            j.categoryNameEn,
                          )}
                        />
                      )}
                    </TableCell>
                    <TableCell className="align-top font-mono text-xs">
                      {h?.officialNumber ?? ""}
                    </TableCell>
                    <TableCell className="align-top">
                      {h && <OneLine text={h.name ?? m.judgements.categoryItself} />}
                      {first && j.hitsWithheld && (
                        // 空なのか伏せたのかが分からないと、入っていないと読まれてしまう
                        <span className="text-muted-foreground text-xs">
                          {m.judgements.basisWithheld}
                        </span>
                      )}
                    </TableCell>
                    {h ? <MatchedCells hit={h} m={m} /> : <TableCell colSpan={2} />}
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

/**
 * 当たった含有率と CAS の出しかた。**含有率のセルと CAS のセットで1組。**
 * 必ず隣り合わせで置く（間に別の列を挟むと読めなくなる）。
 *
 * **合算したのか、個別に当たったのかは「区切り線」で見分ける。**
 * どちらも複数の CAS が縦に並ぶので、見分けが付かないと
 * 「足して超えた」のか「それぞれが超えた」のかを取り違える。
 *
 *   合算 … 含有率は合計ひとつ。CAS はその下に並ぶだけで、線は入らない
 *   個別 … CAS ごとに薄い線で区切り、その左に各 CAS の含有率を並べる
 *
 * 「合算」の札は出さない。**通常は合算で、CAS が1つなら区別する意味も無い。**
 * 札を並べると、読む値より札のほうが目立つ。
 *
 * 1つの CAS が1行を超えないようにしてある。行が増えると表が縦に伸び、
 * 何件当たったのかが読み取りにくくなるため。
 */
export function MatchedCells({ hit, m }: { hit: JudgementHitDto; m: M }) {
  // 合計が入っているのは、まとめて比べたときだけ
  const aggregated = hit.total !== null;

  if (aggregated) {
    return (
      <>
        <TableCell
          className="text-right align-top font-mono tabular-nums"
          title={m.judgements.aggregated}
        >
          {hit.total}%
        </TableCell>
        <TableCell className="align-top font-mono text-xs">
          {hit.contributions.map((c) => (
            // 各CASがいくら効いたかは、合算では畳んである。触れれば読める
            <div key={c.cas} title={`${c.cas} ${c.pct}%`}>
              {c.cas}
            </div>
          ))}
        </TableCell>
      </>
    );
  }

  /** 区切り線の高さを左右で揃えるため、同じ余白・同じ文字の大きさで並べる */
  const cell = "px-2 py-1 leading-5";
  return (
    <>
      <TableCell className="p-0 align-top" title={m.judgements.individually}>
        <div className="divide-border/60 divide-y">
          {hit.contributions.map((c) => (
            <div key={c.cas} className={`${cell} text-right font-mono tabular-nums`}>
              {c.pct}%
            </div>
          ))}
        </div>
      </TableCell>
      <TableCell className="p-0 align-top">
        <div className="divide-border/60 divide-y">
          {hit.contributions.map((c) => (
            <div key={c.cas} className={`${cell} font-mono text-xs`}>
              {c.cas}
            </div>
          ))}
        </div>
      </TableCell>
    </>
  );
}

/**
 * 長い名前を1行に収める。**行を増やさないために、セルの中だけ横に送る。**
 * 折り返すと1件で何行も使い、何件当たったのかが読み取れなくなる。
 *
 * **スクロールバーは出さない。**表の中に細い横棒が何本も並ぶと、
 * 行の区切りと見分けが付かず、表そのものが読みにくくなる。
 * 全文は触れれば読める（title）。
 */
export function OneLine({ text }: { text: string }) {
  return (
    <div
      className="overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      title={text}
    >
      {text}
    </div>
  );
}

/** なぜ確認が要るのか。次に何をすべきかが分かる言葉にする */
export function reasonText(m: M, reason: string): string {
  const table: Record<string, string> = {
    missingFactor: m.judgements.reasonMissingFactor,
    unknownComposition: m.judgements.reasonUnknown,
    truncated: m.judgements.reasonTruncated,
    conditionalExclusion: m.judgements.reasonConditional,
    unfilledThreshold: m.judgements.reasonUnfilled,
  };
  return table[reason] ?? reason;
}
