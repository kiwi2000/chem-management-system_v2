"use client";

import { pickName } from "@chem/shared";
import { Check, CircleAlert, TriangleAlert, UserPen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ProductJudgementDto } from "@/lib/types";

/**
 * その製品の法規制判定。
 *
 * 判定（該当／非該当）と「人が見たかどうか」を**別の欄**に出す。
 * 確認しても判定が変わらないことは普通にあるので、混ぜない。
 *
 * 何が何％入っていたから該当なのか（根拠）まで出す。
 * これが無いと「なぜ該当なのか」に答えられない。
 */
export function ProductJudgements({ productId, canEdit }: { productId: string; canEdit: boolean }) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<ProductJudgementDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** いま根拠を書いている区分。null なら誰も書いていない */
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  /** 該当しないものまで並べると長いので、既定では隠す */
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

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
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

        {items.length === 0 && (
          <p className="text-muted-foreground text-sm">{m.judgements.empty}</p>
        )}

        {shown.map((j) => (
          <div key={j.categoryId} className="border-border space-y-2 border p-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* 判定と、確認の要否は別に出す */}
              <Badge variant={j.verdict === "APPLICABLE" ? "default" : "secondary"}>
                {j.verdict === "APPLICABLE" ? m.judgements.applicable : m.judgements.notApplicable}
              </Badge>
              {j.needsReview && (
                <Badge variant="outline" className="text-destructive gap-1">
                  <CircleAlert className="size-3" />
                  {m.judgements.needsReview}
                </Badge>
              )}
              {j.source === "USER" && (
                <Badge variant="outline" className="gap-1">
                  <UserPen className="size-3" />
                  {m.judgements.byUser}
                </Badge>
              )}
              <span className="text-sm font-medium">
                {pickName(locale, j.lawNameJa ?? j.lawNameOriginal, j.lawNameEn)}
              </span>
              <span className="text-muted-foreground text-sm">
                {pickName(locale, j.categoryNameJa ?? j.categoryNameOriginal, j.categoryNameEn)}
              </span>
            </div>

            {/* なぜ確認が要るのか。理由の分からない警告は、そのうち読まれなくなる */}
            {j.needsReview && (
              <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
                {j.reviewReasons.map((r) => (
                  <li key={r}>{reasonText(m, r)}</li>
                ))}
              </ul>
            )}

            {/* 根拠。何が何％入っていたから該当なのか */}
            {j.hits.length > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground mr-2 text-xs">{m.judgements.basis}</span>
                {j.hits.map((h, i) => (
                  <span key={i} className="mr-3 inline-block">
                    {h.name ?? m.judgements.categoryItself}
                    <span className="text-muted-foreground ml-1 font-mono text-xs">{h.pct}%</span>
                  </span>
                ))}
              </div>
            )}
            {j.hitsWithheld && (
              // 空なのか伏せたのかが分からないと、入っていないと読まれてしまう
              <p className="text-muted-foreground text-xs">{m.judgements.basisWithheld}</p>
            )}

            {j.decidedByName && (
              <p className="text-muted-foreground text-xs">
                {m.judgements.decidedBy(
                  j.decidedByName,
                  j.decidedAt ? new Date(j.decidedAt).toLocaleString(locale) : "",
                )}
                {j.decidedNote && ` — ${j.decidedNote}`}
              </p>
            )}

            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                {editing === j.categoryId ? (
                  <>
                    <Input
                      className="h-8 w-72"
                      placeholder={m.judgements.notePlaceholder}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <Button size="sm" disabled={busy} onClick={() => void decide(j.categoryId)}>
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
                  </>
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
              </div>
            )}
          </div>
        ))}

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

/** なぜ確認が要るのか。管理者が次に何をすべきかが分かる言葉にする */
function reasonText(m: M, reason: string): string {
  const table: Record<string, string> = {
    unknownComposition: m.judgements.reasonUnknown,
    truncated: m.judgements.reasonTruncated,
    conditionalExclusion: m.judgements.reasonConditional,
    unfilledThreshold: m.judgements.reasonUnfilled,
  };
  return table[reason] ?? reason;
}
