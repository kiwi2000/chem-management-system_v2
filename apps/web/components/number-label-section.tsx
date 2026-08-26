"use client";

import { pickName, pickStatutoryName } from "@chem/shared";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, NumberLabelChoiceDto, NumberLabelDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 物質の詳細に「各種番号」として出す番号の設定。
 *
 * ここに並べるのは**インベントリ番号**——その国の名簿が物質に振っている番号。
 * 日本なら化審法番号・安衛法番号、EU なら EC番号、米国なら TSCA の番号。
 *
 * **数は少ない。**規制区分は数十件あるが、番号として引きたいのはその一部だけ。
 * だから全部を並べて選ばせるのではなく、**法律と区分を選んで1件ずつ足す**。
 *
 * 並べた順がそのまま物質の画面での順になる。よく引く番号を上に置くため。
 */

const CELL = "border-r px-2 py-1 last:border-r-0";

/** 画面で持つ1行。保存するまでサーバーには送らない */
interface Row {
  categoryId: string;
  label: string;
}

export function NumberLabelSection() {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<NumberLabelDto[] | null>(null);
  const [choices, setChoices] = useState<NumberLabelChoiceDto[]>([]);
  /** 並べている途中の状態。保存すると items に反映される */
  const [rows, setRows] = useState<Row[]>([]);
  /** 足すときに選んでいる法律と区分 */
  const [lawId, setLawId] = useState("");
  const [categoryId, setCategoryId] = useState("");
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
    const body = (await res.json()) as {
      items: NumberLabelDto[];
      choices: NumberLabelChoiceDto[];
    };
    setItems(body.items);
    setChoices(body.choices);
    setRows(body.items.map((i) => ({ categoryId: i.categoryId, label: i.numberLabel })));
    setLawId("");
    setCategoryId("");
  }, [m]);

  useEffect(() => {
    void load();
  }, [load]);

  const lawName = useCallback(
    (c: { lawNameOriginal: string; lawNameJa: string | null; lawNameEn: string | null }) =>
      pickStatutoryName(locale, c.lawNameOriginal, c.lawNameJa, c.lawNameEn),
    [locale],
  );
  const categoryName = useCallback(
    (c: {
      categoryNameOriginal: string;
      categoryNameJa: string | null;
      categoryNameEn: string | null;
    }) => pickStatutoryName(locale, c.categoryNameOriginal, c.categoryNameJa, c.categoryNameEn),
    [locale],
  );

  /** 足せる法律。同じ法律の区分をまとめる（法律を選んでから区分を選ぶ） */
  const laws = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    for (const c of choices) {
      if (rows.some((r) => r.categoryId === c.categoryId)) continue;
      byId.set(c.lawId, {
        id: c.lawId,
        label: `${pickName(locale, c.countryNameJa, c.countryNameEn)} ${lawName(c)}`,
      });
    }
    return [...byId.values()];
  }, [choices, rows, locale, lawName]);

  /** 選んでいる法律の中で、まだ足していない区分 */
  const categories = useMemo(
    () =>
      choices.filter((c) => c.lawId === lawId && !rows.some((r) => r.categoryId === c.categoryId)),
    [choices, lawId, rows],
  );

  /** 並べた結果と、保存されているものが違うか */
  const dirty =
    items !== null &&
    (rows.length !== items.length ||
      rows.some(
        (r, i) => r.categoryId !== items[i]?.categoryId || r.label !== items[i]?.numberLabel,
      ));

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

  const infoOf = (id: string) =>
    choices.find((c) => c.categoryId === id) ?? items.find((i) => i.categoryId === id) ?? null;

  function add() {
    const c = choices.find((x) => x.categoryId === categoryId);
    if (!c) return;
    setSaved(false);
    // 呼び名は区分の名前から始める。空のままにはさせない（見出しが空になるため）
    setRows((prev) => [...prev, { categoryId: c.categoryId, label: categoryName(c) }]);
    setCategoryId("");
  }

  /** 上下に1つ動かす。ここで並べた順が、そのまま物質の画面の順になる */
  function move(at: number, by: -1 | 1) {
    const to = at + by;
    if (to < 0 || to >= rows.length) return;
    setSaved(false);
    setRows((prev) => {
      const next = [...prev];
      const [row] = next.splice(at, 1);
      if (row) next.splice(to, 0, row);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/number-labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: rows.map((r) => ({ categoryId: r.categoryId, numberLabel: r.label })),
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

  const blank = rows.some((r) => r.label.trim() === "");

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{m.numberLabels.title}</CardTitle>
        <span className="text-muted-foreground text-sm">
          {m.numberLabels.shownCount(rows.length)}
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

        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{m.numberLabels.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/50 border-y text-left">
                  <th className={cn(CELL, "w-16 font-medium")}>{m.numberLabels.order}</th>
                  <th className={cn(CELL, "w-20 font-medium")}>{m.numberLabels.country}</th>
                  <th className={cn(CELL, "w-36 font-medium")}>{m.judgements.law}</th>
                  <th className={cn(CELL, "w-44 font-medium")}>{m.judgements.category}</th>
                  <th className={cn(CELL, "w-36 font-medium")}>{m.numberLabels.samples}</th>
                  <th className={cn(CELL, "font-medium")}>{m.numberLabels.label}</th>
                  <th className={cn(CELL, "w-12")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const info = infoOf(r.categoryId);
                  return (
                    <tr key={r.categoryId} className="border-b">
                      <td className={cn(CELL, "align-middle")}>
                        <div className="flex items-center gap-0.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="size-7 p-0"
                            disabled={i === 0}
                            aria-label={m.numberLabels.moveUp}
                            onClick={() => move(i, -1)}
                          >
                            <ChevronUp className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="size-7 p-0"
                            disabled={i === rows.length - 1}
                            aria-label={m.numberLabels.moveDown}
                            onClick={() => move(i, 1)}
                          >
                            <ChevronDown className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                      <td className={cn(CELL, "text-muted-foreground align-middle text-xs")}>
                        {info && pickName(locale, info.countryNameJa, info.countryNameEn)}
                      </td>
                      <td className={cn(CELL, "align-middle")}>{info && lawName(info)}</td>
                      <td className={cn(CELL, "align-middle")}>{info && categoryName(info)}</td>
                      <td className={cn(CELL, "text-muted-foreground align-middle text-xs")}>
                        {info && (
                          <>
                            <span className="font-mono">{info.samples.join(", ")}</span>
                            <span className="ml-1">{m.numberLabels.count(info.numberCount)}</span>
                          </>
                        )}
                      </td>
                      <td className={cn(CELL, "align-middle")}>
                        <Input
                          className="h-8"
                          value={r.label}
                          maxLength={100}
                          aria-label={m.numberLabels.label}
                          placeholder={m.regulationCategories.numberLabelExample}
                          onChange={(e) => {
                            setSaved(false);
                            const next = e.target.value;
                            setRows((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, label: next } : x)),
                            );
                          }}
                        />
                      </td>
                      <td className={cn(CELL, "align-middle")}>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="size-7 p-0"
                          aria-label={m.common.delete}
                          onClick={() => {
                            setSaved(false);
                            setRows((prev) => prev.filter((_, j) => j !== i));
                          }}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 足す。法律を選んでから区分を選ぶ（区分名だけでは、どの法令のものか分からない） */}
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <label className="text-xs">
            <span className="text-muted-foreground mb-1 block">{m.judgements.law}</span>
            <select
              value={lawId}
              onChange={(e) => {
                setLawId(e.target.value);
                setCategoryId("");
              }}
              className="border-input bg-background h-8 w-56 rounded-none border px-2 text-xs"
            >
              <option value="">{m.numberLabels.pickLaw}</option>
              {laws.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground mb-1 block">{m.judgements.category}</span>
            <select
              value={categoryId}
              disabled={lawId === ""}
              onChange={(e) => setCategoryId(e.target.value)}
              className="border-input bg-background h-8 w-56 rounded-none border px-2 text-xs disabled:opacity-50"
            >
              <option value="">{m.numberLabels.pickCategory}</option>
              {categories.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {categoryName(c)}（{c.numberCount}）
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="outline" disabled={categoryId === ""} onClick={add}>
            <Plus className="mr-1 size-3.5" />
            {m.common.add}
          </Button>
        </div>

        {/* 呼び名が空のまま保存すると、物質の画面で見出しの無い番号が並ぶ */}
        {blank && (
          <Alert variant="destructive">
            <AlertDescription>{m.numberLabels.blankLabel}</AlertDescription>
          </Alert>
        )}

        <Button type="button" disabled={!dirty || blank || busy} onClick={() => void save()}>
          {m.common.save}
        </Button>
      </CardContent>
    </Card>
  );
}
