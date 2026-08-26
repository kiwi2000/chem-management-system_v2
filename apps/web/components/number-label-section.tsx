"use client";

import { pickName, pickStatutoryName } from "@chem/shared";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, NumberLabelDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 物質の詳細に「各種番号」として出す一覧を選ぶ。
 *
 * 官報公示整理番号や政令番号は、**その法令の名簿が振っている番号**であって
 * 物質そのものの属性ではない。だから物質側には入力させず、ここで選んだ一覧から
 * CASリンクをたどって出す。
 *
 * **全部出さない。**どの一覧にも番号は入っているので、全部出すと1物質で20行を超え、
 * 本当に引きたい番号が埋もれる。ここで絞る。
 *
 * 呼び名がそのまま見出しになる。「番号」とだけ書くと、何の番号か分からなくなる。
 */

const CELL = "border-r px-2 py-1 last:border-r-0";

export function NumberLabelSection() {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<NumberLabelDto[] | null>(null);
  /** 触ったものだけを持つ。触っていない行は送らない */
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/number-labels").catch(() => null);
    if (!res) return;
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setItems([]);
      return;
    }
    setItems(((await res.json()) as { items: NumberLabelDto[] }).items);
    setEdited({});
  }, [m]);

  useEffect(() => {
    void load();
  }, [load]);

  if (items === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.numberLabels.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{m.common.loading}</p>
        </CardContent>
      </Card>
    );
  }

  /** いまの値。触っていればその値、触っていなければ保存されている値 */
  const valueOf = (r: NumberLabelDto) => edited[r.categoryId] ?? r.numberLabel ?? "";
  const dirty = Object.keys(edited).length > 0;
  const shownCount = items.filter((r) => valueOf(r).trim() !== "").length;

  const setValue = (categoryId: string, value: string) => {
    setSaved(false);
    setEdited((prev) => ({ ...prev, [categoryId]: value }));
  };

  /**
   * 呼び名の入っていない行に、その区分の名前を入れて出す状態にする。
   * 空欄のまま「出す」にはできない（見出しが空になるため）。
   */
  const turnOn = (r: NumberLabelDto) =>
    setValue(
      r.categoryId,
      pickStatutoryName(locale, r.categoryNameOriginal, r.categoryNameJa, r.categoryNameEn),
    );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/number-labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: Object.entries(edited).map(([categoryId, numberLabel]) => ({
            categoryId,
            numberLabel,
          })),
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setSaved(true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{m.numberLabels.title}</CardTitle>
        <span className="text-muted-foreground text-sm">
          {m.numberLabels.shownCount(shownCount)}
        </span>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">{m.numberLabels.lead}</p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {saved && !dirty && (
          <Alert>
            <AlertDescription>{m.common.saved}</AlertDescription>
          </Alert>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/50 border-y text-left">
                <th className={cn(CELL, "w-24 font-medium")}>{m.numberLabels.country}</th>
                <th className={cn(CELL, "w-40 font-medium")}>{m.judgements.law}</th>
                <th className={cn(CELL, "w-48 font-medium")}>{m.judgements.category}</th>
                <th className={cn(CELL, "w-40 font-medium")}>{m.numberLabels.samples}</th>
                <th className={cn(CELL, "font-medium")}>{m.numberLabels.label}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const value = valueOf(r);
                /*
                  番号が1つも入っていない一覧は、選んでも何も出ない。
                  押せなくはしない（これから入るかもしれない）が、そうと分かるようにする。
                */
                const empty = r.numberCount === 0;
                return (
                  <tr key={r.categoryId} className="border-b">
                    <td className={cn(CELL, "text-muted-foreground align-middle text-xs")}>
                      {pickName(locale, r.countryNameJa, r.countryNameEn)}
                    </td>
                    <td className={cn(CELL, "align-middle")}>
                      {pickStatutoryName(locale, r.lawNameOriginal, r.lawNameJa, r.lawNameEn)}
                    </td>
                    <td className={cn(CELL, "align-middle")}>
                      {pickStatutoryName(
                        locale,
                        r.categoryNameOriginal,
                        r.categoryNameJa,
                        r.categoryNameEn,
                      )}
                    </td>
                    <td className={cn(CELL, "text-muted-foreground align-middle text-xs")}>
                      {empty ? (
                        m.numberLabels.noNumbers
                      ) : (
                        <span className="font-mono">{r.samples.join(", ")}</span>
                      )}
                      <span className="ml-1">{m.numberLabels.count(r.numberCount)}</span>
                    </td>
                    <td className={cn(CELL, "align-middle")}>
                      {value === "" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={empty}
                          onClick={() => turnOn(r)}
                        >
                          {m.numberLabels.turnOn}
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Input
                            className="h-8"
                            value={value}
                            maxLength={100}
                            aria-label={m.numberLabels.label}
                            placeholder={m.regulationCategories.numberLabelExample}
                            onChange={(e) => setValue(r.categoryId, e.target.value)}
                          />
                          {/* 空にすれば出なくなるが、それが分かりにくいのでボタンにする */}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setValue(r.categoryId, "")}
                          >
                            {m.numberLabels.turnOff}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Button type="button" disabled={!dirty || busy} onClick={() => void save()}>
          {m.common.save}
        </Button>
      </CardContent>
    </Card>
  );
}
