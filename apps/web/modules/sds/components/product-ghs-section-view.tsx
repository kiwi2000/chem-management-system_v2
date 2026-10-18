"use client";

import type { Locale } from "@chem/shared";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, WhenCardOpen } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { REVIEW_CLASS } from "@/lib/mark-styles";
import type { ApiError } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ProductGhsJudgementDto } from "../lib/judgement";
import { sdsMessages } from "../messages";
import type { ClassResult, Outcome, ResultNote, TraceEntry, TraceValue } from "../rules/engine";

/**
 * 製品の詳細の「GHS 判定（国）」（SDS 版。S27 §5 の 4）。
 *
 * - 保存してある判定を API から引き、「判定する」で計算し直す（組成を直せる人だけ）
 * - クラスごとに 1 行。結果・要判断の印・注記。行を開くと根拠（処理系の実行の記録）
 * - 根拠は組成を見られる人にだけ（API が成分と根拠を落として返す）
 * - 文言はモジュールの messages に置く（本体の辞書に SDS 版の言葉を入れない）
 */
export function ProductGhsSectionView({
  productId,
  locale,
  country,
  canEdit,
  canViewComposition,
}: {
  productId: string;
  locale: Locale;
  country: string;
  canEdit: boolean;
  canViewComposition: boolean;
}) {
  const t = sdsMessages(locale).judgement;
  const [item, setItem] = useState<ProductGhsJudgementDto | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(
      `/api/modules/sds/ghs-judgement?productId=${encodeURIComponent(productId)}&country=${country}`,
    ).catch(() => null);
    if (!res) return;
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? t.loadFailed(res.status));
      setItem(null);
      return;
    }
    const body = (await res.json()) as { item: ProductGhsJudgementDto | null };
    setItem(body.item);
  }, [productId, country, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function compute() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/modules/sds/ghs-judgement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, country }),
      }).catch(() => null);
      if (!res) return;
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? t.loadFailed(res.status));
        return;
      }
      const body = (await res.json()) as { item: ProductGhsJudgementDto };
      setItem(body.item);
    } finally {
      setBusy(false);
    }
  }

  const results = item?.results ?? [];
  // 開ける行は根拠があるものだけ（組成を見られない人には根拠が来ない）
  const openable = results.filter((r) => r.trace && r.trace.length > 0).map((r) => r.class);
  const allOpen = openable.length > 0 && openable.every((c) => open.has(c));
  const noneOpen = open.size === 0;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          {t.title(country)}
          {item && (
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {t.computedAt(new Date(item.computedAt).toLocaleString(locale), item.asOf)}
              {" / "}
              {t.layers(item.layers.join(" → "))}
            </span>
          )}
        </CardTitle>
        <WhenCardOpen>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {openable.length > 0 && (
              <div className="mr-auto flex items-center gap-1">
                {!allOpen && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setOpen(new Set(openable))}
                  >
                    <ChevronsUpDown className="mr-1 size-3.5" />
                    {t.expandAll}
                  </Button>
                )}
                {!noneOpen && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setOpen(new Set())}
                  >
                    <ChevronsDownUp className="mr-1 size-3.5" />
                    {t.collapseAll}
                  </Button>
                )}
              </div>
            )}
            {canEdit && (
              <Button type="button" size="sm" disabled={busy} onClick={() => void compute()}>
                {busy ? t.computing : item ? t.recompute : t.compute}
              </Button>
            )}
          </div>
        </WhenCardOpen>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-muted-foreground text-sm">{t.lead}</p>
        {item === undefined ? null : item === null ? (
          <p className="text-muted-foreground text-sm">{t.notComputed}</p>
        ) : (
          <>
            {item.inputs.blocked.length > 0 && (
              <Alert>
                <AlertDescription>
                  {t.blocked(item.inputs.blocked.map((b) => `${b.code} ${b.nameJa}`).join(", "))}
                </AlertDescription>
              </Alert>
            )}
            {!canViewComposition && (
              <p className="text-muted-foreground text-xs">{t.basisHidden}</p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-[30%]">{t.hazardClass}</TableHead>
                  <TableHead className="w-[28%]">{t.result}</TableHead>
                  <TableHead>{t.notes}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => {
                  const canOpen = openable.includes(r.class);
                  const isOpen = open.has(r.class);
                  return (
                    <Fragment key={r.class}>
                      <TableRow
                        className={cn(canOpen && "cursor-pointer")}
                        onClick={() => {
                          if (!canOpen) return;
                          setOpen((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.class)) next.delete(r.class);
                            else next.add(r.class);
                            return next;
                          });
                        }}
                      >
                        <TableCell className="w-8 align-top">
                          {canOpen &&
                            (isOpen ? (
                              <ChevronDown className="text-muted-foreground size-4" />
                            ) : (
                              <ChevronRight className="text-muted-foreground size-4" />
                            ))}
                        </TableCell>
                        <TableCell className="align-top">
                          {item.classLabels[r.class] ?? r.class}
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          <OutcomeText outcome={r.outcome} t={t} />
                          {r.remapped && (
                            <span className="text-muted-foreground ml-1 text-xs">
                              {t.remapped(r.remapped.from)}
                            </span>
                          )}
                          {r.judgement.length > 0 && (
                            <Badge variant="outline" className={cn("ml-2", REVIEW_CLASS)}>
                              {t.needsJudgement}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-sm whitespace-normal">
                          <ul className="space-y-0.5">
                            {r.notes.map((n, i) => (
                              <li key={i}>{noteText(n, t)}</li>
                            ))}
                            {r.judgement.map((j, i) => (
                              <li key={`j${i}`} className={REVIEW_CLASS}>
                                {judgementText(j, t)}
                              </li>
                            ))}
                            {r.because.map((b, i) => (
                              <li key={`b${i}`} className="text-muted-foreground">
                                {b}
                              </li>
                            ))}
                          </ul>
                        </TableCell>
                      </TableRow>
                      {isOpen && r.trace && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={3}>
                            <Basis result={r} item={item} t={t} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type Judgement = ReturnType<typeof sdsMessages>["judgement"];

function OutcomeText({ outcome, t }: { outcome: Outcome | null; t: Judgement }) {
  if (!outcome) return <span className={REVIEW_CLASS}>{t.noResult}</span>;
  if (outcome.kind === "category")
    return <span className="font-medium">{t.category(outcome.category)}</span>;
  return (
    <span className={cn(outcome.kind === "not_classified" && "text-muted-foreground")}>
      {t.outcome[outcome.kind]}
    </span>
  );
}

function outcomeLabel(outcome: Outcome, t: Judgement): string {
  return outcome.kind === "category" ? t.category(outcome.category) : t.outcome[outcome.kind];
}

function noteText(n: ResultNote, t: Judgement): string {
  if (n.text !== undefined) return n.text;
  const render = t.noteCode[n.code];
  return render ? render(n.params ?? {}) : n.code;
}

function judgementText(code: string, t: Judgement): string {
  return (t.judgementCode as Record<string, string | undefined>)[code] ?? code;
}

function valueText(v: TraceValue): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.join(", ");
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * 根拠。処理系の記録（TraceEntry）を、3 つのまとまりに分けて出す。
 *   1. 考慮した成分（consider / ignore / flag を成分ごとにまとめる）
 *   2. 成分ごとの値（assign_per_ingredient）
 *   3. 計算の流れ（それ以外を順に）
 */
function Basis({
  result,
  item,
  t,
}: {
  result: ClassResult;
  item: ProductGhsJudgementDto;
  t: Judgement;
}) {
  const trace = result.trace ?? [];
  const perIngredient = new Map<
    string,
    { included?: boolean; excluded?: boolean; flags: string[]; texts: string[] }
  >();
  const perValue: Extract<TraceEntry, { kind: "assign_per_ingredient" }>[] = [];
  const steps: TraceEntry[] = [];
  for (const e of trace) {
    if (e.kind === "consider" || e.kind === "ignore" || e.kind === "flag") {
      const cur = perIngredient.get(e.ingredient) ?? { flags: [], texts: [] };
      if (e.kind === "consider") {
        cur.included = e.included;
        cur.texts.push(e.text);
      } else if (e.kind === "ignore") {
        cur.excluded = e.excluded;
        cur.texts.push(e.text);
      } else cur.flags.push(e.flag);
      perIngredient.set(e.ingredient, cur);
    } else if (e.kind === "assign_per_ingredient") perValue.push(e);
    else steps.push(e);
  }
  const pctOf = new Map(item.inputs.ingredients.map((s) => [s.nameJa || s.code, s.pct]));

  return (
    <div className="space-y-3 text-sm">
      {perIngredient.size > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 text-xs font-medium">{t.basisIngredients}</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.basisIngredientName}</TableHead>
                <TableHead className="text-right">{t.basisPct}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...perIngredient.entries()].map(([name, info]) => {
                const dropped = info.included === false || info.excluded === true;
                return (
                  <TableRow key={name} className={cn(dropped && "text-muted-foreground")}>
                    <TableCell>{name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pctOf.get(name) ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal">
                      {dropped ? t.basisExcluded : t.basisIncluded}
                      {info.texts.length > 0 && (
                        <span className="ml-1">（{info.texts.join(" / ")}）</span>
                      )}
                      {info.flags.map((f) => (
                        <span key={f} className="ml-1">
                          {t.basisFlag(f)}
                        </span>
                      ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {perValue.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 text-xs font-medium">{t.basisValues}</div>
          <ul className="space-y-1">
            {perValue.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-xs">
                  {e.name} = {e.text}
                </span>
                <ul className="ml-4 list-disc">
                  {e.values.map((v) => (
                    <li key={v.ingredient} className="tabular-nums">
                      {v.ingredient}: {valueText(v.value)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {steps.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 text-xs font-medium">{t.basisStep}</div>
          <ol className="list-decimal space-y-0.5 pl-5">
            {steps.map((e, i) => (
              <li key={i}>{stepText(e, t)}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function stepText(e: TraceEntry, t: Judgement): string {
  switch (e.kind) {
    case "assign":
      return t.basisAssign(e.name, valueText(e.value), e.text);
    case "if":
      return t.basisCondition(e.text, e.result);
    case "classify":
      return t.basisClassify(e.category) + (e.because ? `（${e.because}）` : "");
    case "bands":
      return e.cappedTo && e.category
        ? t.basisBands(String(e.value), e.category) + "。" + t.basisCapped(e.category, e.cappedTo)
        : t.basisBands(String(e.value), e.category);
    case "option":
      return t.basisOption(e.name, e.value ?? "—", e.chosenBy ?? "—");
    case "outcome":
      return t.basisOutcome(outcomeLabel(e.outcome, t));
    default:
      return "";
  }
}
