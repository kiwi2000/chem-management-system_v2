"use client";

import { pickName } from "@chem/shared";
import {
  Check,
  ChevronRight,
  CircleHelp,
  FoldVertical,
  TriangleAlert,
  UnfoldVertical,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  STICKY_HEAD_LINES,
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

/** 組成の表と同じ枠線・余白。並べて見るので、見た目をそろえる */
const CELL = "border-r px-2 py-1 last:border-r-0";

/**
 * 列の並びと既定の幅。**見出しと幅を1か所に持つ。**
 * 別々に書くと、列を足したときに幅だけ古いまま残って気づけない。
 *
 * **判定の列は置かない。該当したものしか並べないため。**
 *
 * 重量%と該当CASは2つで1組。**間に別の列を挟まないこと**（合算かどうかが読めなくなる）。
 * スコアはその右に置く。**CASの隣**なので、どの物質の点数かが読める。
 */
const HEADS: { key: string; width: number; label: (m: M) => string; className?: string }[] = [
  { key: "law", width: 80, label: (m) => m.judgements.law },
  // 区分の行にだけ開閉のつまみが付く。そのぶん少し広く取る
  { key: "category", width: 176, label: (m) => m.judgements.category },
  { key: "number", width: 56, label: (m) => m.judgements.number },
  // 1280px の画面で表がなるべく収まるよう、長い文字の列は少し詰める（切れた分は押せば読める）
  { key: "statutoryName", width: 240, label: (m) => m.judgements.statutoryName },
  { key: "content", width: 72, label: (m) => m.judgements.content, className: "text-right" },
  { key: "matchedCas", width: 96, label: (m) => m.judgements.matchedCas },
  // 見出しの「スコア」がちょうど収まる幅。組成の表とそろえる
  { key: "score", width: 60, label: (m) => m.judgements.score, className: "text-right" },
  { key: "warning", width: 200, label: (m) => m.judgements.warning },
];

/**
 * 操作の列。編集できる人にだけ出るので、列の並びとは別に持つ。
 *
 * **「判定修正」を押したときに開く欄が収まる幅にする。**
 * 押していないあいだはボタン1つぶんで足りるが、開くと根拠の入力欄と
 * ボタン3つがこの中に入る。狭いままだと文字が切れて読めなかった
 */
const ACTION_COLUMN = { key: "actions", width: 224 };

export function ProductJudgements({
  productId,
  canEdit,
  version,
}: {
  productId: string;
  canEdit: boolean;
  /**
   * この判定に使った法規制のバージョン。
   * **どのバージョンで出した結果かが分からないと、印刷して人に渡せない。**
   */
  version: string | null;
}) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<ProductJudgementDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** いま根拠を書いている区分。null なら誰も書いていない */
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * 中身（法文物質名）を開いている区分。
   * **既定は全部閉じる。**当たった区分が何かをまず見せ、
   * 中身は必要なものだけ開く（区分ごとに何行も続くと、何件当たったのか読めない）。
   */
  const [open, setOpen] = useState<Set<string>>(new Set());
  /**
   * 該当したものだけに絞るか。**既定は絞る。**
   * ふだん見たいのは当たったものだけだが、**非該当に直した判定を戻す口が要る**ので、
   * 外して全部出せるようにしてある。
   */
  const [onlyApplicable, setOnlyApplicable] = useState(true);
  // 列幅は一覧と同じ規則。操作の列は、出るときだけ幅を数に入れる
  const cols = useResizableColumns(
    // 末尾の版を上げると、覚えている列幅を捨てて既定から始め直す
    "chem.table.productJudgements.v3",
    [...HEADS, ...(canEdit ? [ACTION_COLUMN] : [])],
    // 幅を詰めない。詰めると製品ごと・画面幅ごとに列の位置が動いて見比べられない
    { shrinkToFit: false, rowLabel: m.table.resizeRows },
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
  const shown = onlyApplicable ? applicable : items;
  const review = shown.filter((j) => j.needsReview);
  /** 中身を持つ区分。「展開」「格納」を出すかどうかの判断に使う */
  const openable = shown.filter((j) => j.hits.length > 0).map((j) => j.categoryId);

  const toggle = (categoryId: string) => {
    const next = new Set(open);
    if (next.has(categoryId)) next.delete(categoryId);
    else next.add(categoryId);
    setOpen(next);
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          {m.judgements.title}
          {version && (
            <span className="text-muted-foreground ml-2 text-xs font-normal">{version}</span>
          )}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {m.judgements.summary(applicable.length, items.length)}
          </span>
          {review.length > 0 && (
            <Badge variant="secondary" className="gap-1">
              <CircleHelp className="size-3" />
              {m.judgements.reviewCount(review.length)}
            </Badge>
          )}
          <Button
            type="button"
            size="sm"
            variant={onlyApplicable ? "default" : "outline"}
            aria-pressed={onlyApplicable}
            onClick={() => setOnlyApplicable(!onlyApplicable)}
          >
            {m.judgements.onlyApplicable}
          </Button>
          {/* 開くものが無ければ置いても押せないので出さない。組成の表と同じ形 */}
          {openable.length > 0 && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={openable.every((id) => open.has(id))}
                onClick={() => setOpen(new Set(openable))}
              >
                <UnfoldVertical className="mr-1 size-3.5" />
                {m.composition.expandAll}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={open.size === 0}
                onClick={() => setOpen(new Set())}
              >
                <FoldVertical className="mr-1 size-3.5" />
                {m.composition.collapseAll}
              </Button>
            </div>
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
          /*
            横に長く、行も多くなる表なので、**この箱の中だけで縦横に送る**
            （画面全体を振らない）。高さを決めておくと、横のスクロールバーが
            箱の下端に来るので、見出しを見ながら動かせる
          */
          <div ref={cols.scrollerRef} className="max-h-[70vh] overflow-auto" {...cols.rowProps}>
            {/* 切れているセルにマウスを置いたとき、中身を全部出す吹き出し */}
            {cols.peek}
            {/*
              table-fixed にして、幅を列の側で決める。
              自動幅だと、法文物質名の長いものが1件あるだけで表全体の形が変わり、
              製品ごとに列の位置がずれて見比べられなくなる。
              幅は一覧と同じ規則で、見出しの右端をつまんで変えられる。
            */}
            <Table
              {...cols.tableProps}
              className={cn("table-fixed text-sm", cols.tableProps.className)}
              // 外側の箱で流すので、表を包む枠は流さない（入れ子にすると見出しを貼り付けられない）
              containerClassName="overflow-visible"
            >
              <colgroup>{cols.cols()}</colgroup>
              {/*
                見出しは箱の上に貼り付ける。**色は行ではなく `TableHeader` に置く。**
                行に置くと、枠線を重ねて描く表（`border-collapse: collapse`）では
                いちばん上の1〜2pxが塗られず、流れていく行がそこから覗く
              */}
              <TableHeader
                className={cn(
                  "table-head-solid text-table-head-foreground sticky top-0 z-20",
                  STICKY_HEAD_LINES,
                )}
              >
                {/* 色と枠線は組成の表にそろえる。並べて見るので、別物に見えると困る */}
                <TableRow className="border-y hover:bg-transparent">
                  {HEADS.map(({ key, label, className }, i) => (
                    <TableHead key={key} className={cn(CELL, "relative h-auto", className)}>
                      {/* 行の高さのつまみは、いちばん左の見出しに1つだけ */}
                      {i === 0 && cols.rowHandle()}
                      {label(m)}
                      {cols.handle(key, `${label(m)} ${m.table.resize}`)}
                    </TableHead>
                  ))}
                  {canEdit && (
                    <TableHead className={cn(CELL, "relative h-auto")}>
                      {cols.handle("actions", m.table.resize)}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((j) => {
                  const opened = open.has(j.categoryId);
                  const many = j.hits.length > 0;
                  return (
                    <Fragment key={j.categoryId}>
                      {/* 区分の行。中身（法文物質名）は押して開く */}
                      <TableRow className="border-b">
                        <TableCell className={cn(CELL, "align-top")}>
                          {pickName(locale, j.lawNameJa ?? j.lawNameOriginal, j.lawNameEn)}
                        </TableCell>
                        <TableCell className={cn(CELL, "align-top")}>
                          {many ? (
                            <button
                              type="button"
                              onClick={() => toggle(j.categoryId)}
                              aria-expanded={opened}
                              aria-label={
                                opened ? m.composition.collapseAll : m.composition.expandAll
                              }
                              className="hover:text-foreground -ml-1 flex w-full items-center gap-1 text-left"
                            >
                              <ChevronRight
                                className={cn(
                                  "text-muted-foreground size-4 shrink-0 transition-transform",
                                  opened && "rotate-90",
                                )}
                              />
                              <OneLine
                                text={pickName(
                                  locale,
                                  j.categoryNameJa ?? j.categoryNameOriginal,
                                  j.categoryNameEn,
                                )}
                              />
                            </button>
                          ) : (
                            <OneLine
                              text={pickName(
                                locale,
                                j.categoryNameJa ?? j.categoryNameOriginal,
                                j.categoryNameEn,
                              )}
                            />
                          )}
                          {/*
                            判定の列は置いていない。絞りを外したときだけ、
                            非該当のものにここで印を付ける（印が無い＝該当）。
                          */}
                          {j.verdict !== "APPLICABLE" && (
                            <Badge variant="secondary" className="mt-0.5">
                              {m.judgements.notApplicable}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className={CELL} />
                        {/*
                          閉じているあいだは、中身のかわりに件数を出す。
                          空欄にすると「何にも当たっていない」に見える。
                        */}
                        <TableCell className={cn(CELL, "text-muted-foreground align-top text-xs")}>
                          {many && !opened && m.judgements.hitCount(j.hits.length)}
                          {j.hitsWithheld && (
                            <span className="block">{m.judgements.basisWithheld}</span>
                          )}
                        </TableCell>
                        <TableCell className={CELL} />
                        <TableCell className={CELL} />
                        {/* 区分の行には**区分に付けた点数**を出す。物質の点数はこの合計 */}
                        <TableCell
                          className={cn(CELL, "text-right align-top font-mono tabular-nums")}
                        >
                          {j.categoryScore}
                        </TableCell>
                        <TableCell className={cn(CELL, "align-top")}>
                          <Warning j={j} m={m} locale={locale} />
                        </TableCell>
                        {canEdit && (
                          <TableCell className={cn(CELL, "align-top")}>
                            {editing === j.categoryId ? (
                              <div className="space-y-1">
                                <Input
                                  // 列の幅いっぱい。決め打ちにすると列より広くなって切れる
                                  className="h-8 w-full"
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
                                        j.verdict === "APPLICABLE"
                                          ? "NOT_APPLICABLE"
                                          : "APPLICABLE",
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
                            )}
                          </TableCell>
                        )}
                      </TableRow>

                      {/* 中身。1行＝当たった法文物質名1件 */}
                      {opened &&
                        j.hits.map((h, i) => (
                          <TableRow key={`${j.categoryId}-${i}`} className="bg-muted/40 border-b">
                            <TableCell className={CELL} />
                            <TableCell className={CELL} />
                            <TableCell className={cn(CELL, "align-top font-mono text-xs")}>
                              {h.officialNumber ?? ""}
                            </TableCell>
                            <TableCell className={cn(CELL, "align-top")}>
                              <OneLine text={h.name ?? m.judgements.categoryItself} />
                            </TableCell>
                            <MatchedCells hit={h} m={m} cellClass={CELL} />
                            {/* その行を作った物質の点数。合算した行は寄与ぶんの合計 */}
                            <TableCell
                              className={cn(CELL, "text-right align-top font-mono tabular-nums")}
                            >
                              {h.score ?? ""}
                            </TableCell>
                            <TableCell className={CELL} />
                            {canEdit && <TableCell className={CELL} />}
                          </TableRow>
                        ))}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * その区分に添える警告。**確認が残っているかどうかと、誰がいつ確認したか。**
 *
 * 理由の無い警告は読まれなくなるので、なぜ気になるのかを必ず添える。
 */
function Warning({
  j,
  m,
  locale,
}: {
  j: ProductJudgementDto;
  m: M;
  locale: ReturnType<typeof useI18n>["locale"];
}) {
  return (
    <>
      {/*
        **警告と要確認は別。**要確認でなくても、気を付けることがあれば必ず出す。
        条件つきで結ばれたCASは、システム設定によっては要確認にせず警告だけになる
      */}
      {j.reviewReasons.length > 0 && (
        <div className="space-y-1">
          {/* 囲みも太字も付けない。行の幅を食うので、印と色だけで示す */}
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              j.needsReview ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {/*
              **要確認と警告で印を分ける。**要確認は「判定が変わるかもしれない」なので
              「?」、警告は気を付ける相手なので三角。同じ印だと区別が付かない
            */}
            {j.needsReview ? (
              <CircleHelp className="size-3" />
            ) : (
              <TriangleAlert className="size-3" />
            )}
            {j.needsReview ? m.judgements.needsReview : m.judgements.warning}
          </span>
          <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
            {j.reviewReasons.map((r) => (
              <li key={r}>{reasonText(m, r)}</li>
            ))}
          </ul>
        </div>
      )}
      {!j.needsReview && j.decidedByName && (
        <p className="text-muted-foreground text-xs">
          {m.judgements.decidedBy(
            j.decidedByName,
            j.decidedAt ? new Date(j.decidedAt).toLocaleString(locale) : "",
          )}
          {j.decidedNote && ` — ${j.decidedNote}`}
        </p>
      )}
      {j.source === "USER" && (
        <Badge variant="outline" className="mt-1">
          {m.judgements.byUser}
        </Badge>
      )}
    </>
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
export function MatchedCells({
  hit,
  m,
  cellClass = "",
}: {
  hit: JudgementHitDto;
  m: M;
  /** セルに足す枠線・余白。並べる表に合わせる */
  cellClass?: string;
}) {
  // 合計が入っているのは、まとめて比べたときだけ
  const aggregated = hit.total !== null;

  if (aggregated) {
    return (
      <>
        <TableCell
          className={cn(cellClass, "text-right align-top font-mono tabular-nums")}
          title={m.judgements.aggregated}
        >
          {hit.total}%
        </TableCell>
        <TableCell className={cn(cellClass, "align-top font-mono text-xs")}>
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
      <TableCell className={cn(cellClass, "p-0 align-top")} title={m.judgements.individually}>
        <div className="divide-border/60 divide-y">
          {hit.contributions.map((c) => (
            <div key={c.cas} className={`${cell} text-right font-mono tabular-nums`}>
              {c.pct}%
            </div>
          ))}
        </div>
      </TableCell>
      <TableCell className={cn(cellClass, "p-0 align-top")}>
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
    conditionalLink: m.judgements.reasonConditionalLink,
    homogeneousMaterial: m.judgements.reasonHomogeneous,
  };
  return table[reason] ?? reason;
}
