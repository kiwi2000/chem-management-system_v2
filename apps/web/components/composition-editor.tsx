"use client";

import {
  COMPOSITION_MAX_LINES,
  fromScaled,
  pickName,
  sumScaled,
  validateCompositionSum,
  type AppSettings,
} from "@chem/shared";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type {
  ApiError,
  CompositionElementDto,
  CompositionLineDto,
  CompositionResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  productId: string;
  /** 合計チェックの厳しさ。サーバー側で解決して渡す（設定は管理者しか読めない） */
  settings: AppSettings;
  /**
   * 書き換えられる状態か。製品の編集と足並みを揃えるため、この節だけの
   * 「編集」ボタンは持たず、製品側から渡してもらう。
   */
  editing: boolean;
}

/** 画面が持つ行。保存するまで id を持たない行があるので、並べ替え用の鍵を別に振る */
interface Row {
  key: string;
  kind: "substance" | "product";
  element: CompositionElementDto;
  contentPct: string;
  isBalance: boolean;
  note: string;
}

type Kind = Row["kind"];

const CELL = "border-r px-2 py-1 last:border-r-0";

function toRow(l: CompositionLineDto, index: number): Row | null {
  if (!l.element) return null;
  return {
    key: l.id || `row-${index}`,
    kind: l.childProductId ? "product" : "substance",
    element: l.element,
    contentPct: l.contentPct ?? "",
    isBalance: l.isBalance,
    note: l.note ?? "",
  };
}

/**
 * 原組成の編集。
 * 製品詳細の下に置き、製品本体とは別に保存する（行数が多いので、
 * 名称を触っていないのに全部保存し直すのを避けるため）。
 */
export function CompositionEditor({ productId, settings, editing: editable }: Props) {
  const { m, locale } = useI18n();

  // 表の「＋」から、下の検索欄へ飛ばすために持つ
  const searchRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  // 並べ替え中の行と、いま重ねている行
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  // サーバー側でも可否を見ている。製品が編集中で、かつ権限があるときだけ書き換えられる
  const editing = editable && canEdit;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 追加用の検索
  const [kind, setKind] = useState<Kind>("substance");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<CompositionElementDto[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    const res = await fetch(`/api/products/${productId}/composition`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setLoadError(body?.error.message ?? m.errors.loadFailed(res.status));
      setRows([]);
      return;
    }
    const body = (await res.json()) as CompositionResponse & { canEdit: boolean };
    setRows(body.lines.map(toRow).filter((r) => r !== null));
    setCanEdit(body.canEdit);
  }, [productId, m]);

  useEffect(() => {
    void load();
  }, [load]);

  // 入力途中でも合計が見えるように、サーバーと同じ判定をその場でも回す
  const sum = useMemo(
    () =>
      validateCompositionSum(
        (rows ?? []).map((r) => ({ contentPct: r.contentPct || null, isBalance: r.isBalance })),
        settings,
        m,
      ),
    [rows, settings, m],
  );

  /** 候補の検索。入力が落ち着いてから引く */
  useEffect(() => {
    if (!editing || query.trim() === "") {
      setCandidates(null);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const params = new URLSearchParams({ kind, q: query, exclude: productId });
          const res = await fetch(`/api/composition/candidates?${params.toString()}`);
          if (!res.ok) {
            if (redirectIfUnauthorized(res)) return;
            setCandidates([]);
            return;
          }
          setCandidates(((await res.json()) as { items: CompositionElementDto[] }).items);
        } finally {
          setSearching(false);
        }
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [editing, query, kind, productId]);

  function update(index: number, patch: Partial<Row>) {
    setRows((prev) => prev?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? prev);
  }

  /** つかんで運んだ行を、落とした位置へ入れ直す */
  function reorder(from: number, to: number) {
    setRows((prev) => {
      if (!prev || from === to || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  }

  function move(index: number, delta: number) {
    setRows((prev) => {
      if (!prev) return prev;
      const to = index + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  }

  function add(element: CompositionElementDto) {
    setRows((prev) => [
      ...(prev ?? []),
      { key: `new-${element.id}`, kind, element, contentPct: "", isBalance: false, note: "" },
    ]);
    setQuery("");
    setCandidates(null);
  }

  async function onSave() {
    if (!rows) return;
    setErrors([]);
    setWarnings([]);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${productId}/composition`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: rows.map((r) => ({
            substanceId: r.kind === "substance" ? r.element.id : null,
            childProductId: r.kind === "product" ? r.element.id : null,
            contentPct: r.isBalance ? null : r.contentPct,
            isBalance: r.isBalance,
            note: r.note || null,
          })),
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as
          (ApiError & { error: { details?: { errors?: string[] } } }) | null;
        setErrors(
          body?.error.details?.errors ?? [body?.error.message ?? m.errors.saveFailed(res.status)],
        );
        return;
      }
      const body = (await res.json()) as { warnings: string[] };
      setWarnings(body.warnings);
      setNotice(body.warnings.length > 0 ? m.composition.savedWithWarnings : m.composition.saved);
      void load();
    } finally {
      setSaving(false);
    }
  }

  /**
   * 表に出す合計。
   * サーバーが返す totalPct は残部を除いた「入力済み」の合計なので、
   * そのまま「合計」として出すと 100% にならず、足りないように見えてしまう。
   */
  const grandTotalPct = useMemo(
    () => fromScaled(sumScaled([sum.totalPct, sum.balancePct])),
    [sum.totalPct, sum.balancePct],
  );

  const alreadyAdded = useMemo(
    () => new Set((rows ?? []).map((r) => `${r.kind}:${r.element.id}`)),
    [rows],
  );
  const full = (rows?.length ?? 0) >= COMPOSITION_MAX_LINES;

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.composition.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{m.composition.title}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {rows === null ? (
          <p className="text-muted-foreground text-sm">{m.common.loading}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{m.composition.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="bg-muted/50 border-y text-left">
                  {/* 行をつかんで並べ替えるためのつまみ */}
                  {editing && <th className={cn(CELL, "w-8")} />}
                  <th className={cn(CELL, "w-28 font-medium")}>{m.composition.elementId}</th>
                  <th className={cn(CELL, "w-32 font-medium")}>{m.composition.casNumber}</th>
                  <th className={cn(CELL, "font-medium")}>{m.composition.elementName}</th>
                  <th className={cn(CELL, "w-28 text-right font-medium")}>
                    {m.composition.contentPct}
                  </th>
                  <th className={cn(CELL, "w-40 font-medium")}>{m.composition.note}</th>
                  {/* 残部の切り替えと行の操作は、直しているときだけ出す */}
                  {editing && (
                    <th className={cn(CELL, "w-16 text-center font-medium")}>
                      {m.composition.balance}
                    </th>
                  )}
                  {editing && <th className={cn(CELL, "w-24")} />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.key}
                    className={cn(
                      "border-b",
                      dragIndex === i && "opacity-40",
                      overIndex === i && dragIndex !== i && "border-primary border-t-2",
                    )}
                    onDragOver={(e) => {
                      if (dragIndex === null) return;
                      // 既定では落とせないので、受け取れることを伝える
                      e.preventDefault();
                      setOverIndex(i);
                    }}
                    onDrop={(e) => {
                      if (dragIndex === null) return;
                      e.preventDefault();
                      reorder(dragIndex, i);
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                  >
                    {editing && (
                      <td className={cn(CELL, "w-8 px-1")}>
                        <button
                          type="button"
                          draggable
                          aria-label={m.composition.dragHint}
                          title={m.composition.dragHint}
                          className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
                          onDragStart={(e) => {
                            setDragIndex(i);
                            e.dataTransfer.effectAllowed = "move";
                            // Firefox は中身が空だと運べない
                            e.dataTransfer.setData("text/plain", String(i));
                            // つまみだけでなく行ごと動いて見えるようにする
                            const tr = e.currentTarget.closest("tr");
                            if (tr) e.dataTransfer.setDragImage(tr, 0, 0);
                          }}
                          onDragEnd={() => {
                            setDragIndex(null);
                            setOverIndex(null);
                          }}
                          // つかめない人のために、矢印キーでも動かせるようにする
                          onKeyDown={(e) => {
                            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                            e.preventDefault();
                            move(i, e.key === "ArrowUp" ? -1 : 1);
                          }}
                        >
                          <GripVertical className="size-4" />
                        </button>
                      </td>
                    )}
                    <td className={cn(CELL, "font-mono text-xs")}>{r.element.code}</td>
                    <td className={cn(CELL, "font-mono text-xs")}>
                      {r.element.casNumber ?? (
                        // 原材料にCASは無い。値と紛れないよう淡い文字にする
                        <span className="text-muted-foreground font-sans">
                          {m.composition.kindProduct}
                        </span>
                      )}
                    </td>
                    <td className={CELL}>{pickName(locale, r.element.nameJa, r.element.nameEn)}</td>
                    <td className={cn(CELL, "text-right")}>
                      {r.isBalance ? (
                        <span className="text-muted-foreground text-xs">
                          {sum.balancePct === null
                            ? m.composition.balanceAuto
                            : m.composition.balanceOf(sum.balancePct)}
                        </span>
                      ) : editing ? (
                        <Input
                          aria-label={`${r.element.code} ${m.composition.contentPct}`}
                          inputMode="decimal"
                          value={r.contentPct}
                          onChange={(e) => update(i, { contentPct: e.target.value })}
                          className="h-8 w-24 text-right"
                        />
                      ) : (
                        r.contentPct
                      )}
                    </td>
                    <td className={CELL}>
                      {editing ? (
                        <Input
                          aria-label={`${r.element.code} ${m.composition.note}`}
                          maxLength={500}
                          value={r.note}
                          onChange={(e) => update(i, { note: e.target.value })}
                          className="h-8"
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">{r.note}</span>
                      )}
                    </td>
                    {editing && (
                      <td className={cn(CELL, "text-center")} title={m.composition.balanceHint}>
                        <input
                          type="checkbox"
                          aria-label={`${r.element.code} ${m.composition.balance}`}
                          checked={r.isBalance}
                          disabled={!settings.compositionBalanceAllowed}
                          onChange={(e) =>
                            update(i, { isBalance: e.target.checked, contentPct: "" })
                          }
                        />
                      </td>
                    )}
                    {editing && (
                      <td className={cn(CELL, "w-12 px-1 text-center")}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`${m.common.delete} ${r.element.code}`}
                          className="text-destructive"
                          onClick={() => setRows(rows.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 border-t">
                  {/* 合計は数字の真上に来るよう、重量%の1つ手前まで結合する */}
                  <td className={cn(CELL, "text-right font-medium")} colSpan={editing ? 4 : 3}>
                    {m.composition.sumLabel}
                  </td>
                  <td className={cn(CELL, "text-right font-medium")}>{grandTotalPct}%</td>
                  <td className={CELL} />
                  {editing && <td className={CELL} />}
                  {editing && (
                    <td className={cn(CELL, "w-12 px-1 text-center")}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={m.composition.addLine}
                        title={m.composition.addLine}
                        onClick={() => searchRef.current?.focus()}
                      >
                        <Plus className="size-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {editing && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={m.composition.kind}
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="border-input bg-background h-9 rounded-none border px-2 text-sm"
              >
                <option value="substance">{m.composition.kindSubstance}</option>
                <option value="product">{m.composition.kindProduct}</option>
              </select>
              <Input
                ref={searchRef}
                aria-label={m.composition.searchPlaceholder}
                value={query}
                disabled={full}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={m.composition.searchPlaceholder}
                className="w-72"
              />
              {searching && (
                <span className="text-muted-foreground text-xs">{m.composition.searching}</span>
              )}
              {full && (
                <span className="text-muted-foreground text-xs">
                  {m.validation.tooMany(COMPOSITION_MAX_LINES)}
                </span>
              )}
            </div>

            {candidates !== null &&
              (candidates.length === 0 ? (
                <p className="text-muted-foreground text-xs">{m.composition.noCandidates}</p>
              ) : (
                <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
                  {candidates.map((c) => {
                    const added = alreadyAdded.has(`${kind}:${c.id}`);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          disabled={added || full}
                          onClick={() => add(c)}
                          className="hover:bg-muted flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm disabled:opacity-50"
                        >
                          <span className="font-mono text-xs">{c.code}</span>
                          <span>{pickName(locale, c.nameJa, c.nameEn)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ))}
          </div>
        )}

        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              <ul className="list-disc pl-5">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <AlertDescription>
              <p className="font-medium">{notice}</p>
              {warnings.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}

        {editing && (
          <div className="flex gap-2">
            <Button type="button" disabled={saving} onClick={() => void onSave()}>
              {saving ? m.common.saving : m.common.save}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // 編集をやめるのは製品側の役目。ここは書きかけを捨てて読み直すだけ
                setErrors([]);
                setNotice(null);
                void load();
              }}
            >
              {m.composition.discard}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
