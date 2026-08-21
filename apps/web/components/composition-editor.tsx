"use client";

import {
  COMPOSITION_MAX_LINES,
  fromScaled,
  pickName,
  SCALED_HUNDRED,
  sumScaled,
  validateCompositionSum,
  type AppSettings,
  type TextOperator,
} from "@chem/shared";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type {
  ApiError,
  CompositionCandidateDto,
  CompositionElementDto,
  CompositionLineDto,
  CompositionResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  productId: string;
  /** 合計チェックの厳しさ。サーバー側で解決して渡す（設定は管理者しか読めない） */
  settings: AppSettings;
  /** 書き換えられる状態か。開始と終了は製品側が仕切る */
  editing: boolean;
  /** 「編集」を押したとき。渡さないとボタンを出さない（ウィザードなど） */
  onRequestEdit?: () => void;
  /** 保存または破棄で、この節の編集を終えたとき */
  onFinishEdit?: () => void;
}

/** 名称の突合で選べるもの。「空白」「空白でない」は候補探しに使わない */
const NAME_OPS = ["contains", "startsWith", "endsWith", "equals"] as const;

/** 名称を探す範囲。既定は主名称の日本語だけ */
const NAME_SCOPES = ["mainJa", "all"] as const;
type NameScope = (typeof NAME_SCOPES)[number];

/** 画面が持つ行。保存するまで id を持たない行があるので、並べ替え用の鍵を別に振る */
interface Row {
  key: string;
  kind: "substance" | "product";
  element: CompositionElementDto;
  contentPct: string;
  isBalance: boolean;
  note: string;
}

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
export function CompositionEditor({
  productId,
  settings,
  editing: editable,
  onRequestEdit,
  onFinishEdit,
}: Props) {
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
  /** 検索の条件。入れた条件はすべて満たすものを探す */
  const [cond, setCond] = useState({
    id: "",
    cas: "",
    name: "",
    nameOp: "contains" as TextOperator,
    nameScope: "mainJa" as NameScope,
    substance: true,
    product: true,
  });
  const [candidates, setCandidates] = useState<CompositionCandidateDto[] | null>(null);
  /** 結果から選んだもの。「種別:ID」で持つ */
  const [picked, setPicked] = useState<Set<string>>(new Set());
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

  /** 条件で候補を探す。打つたびではなく「検索」で引く */
  async function search() {
    setSearching(true);
    setPicked(new Set());
    try {
      const params = new URLSearchParams({
        id: cond.id,
        cas: cond.cas,
        name: cond.name,
        nameOp: cond.nameOp,
        nameScope: cond.nameScope,
        substance: cond.substance ? "1" : "0",
        product: cond.product ? "1" : "0",
        exclude: productId,
      });
      const res = await fetch(`/api/composition/candidates?${params.toString()}`);
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        setCandidates([]);
        return;
      }
      setCandidates(((await res.json()) as { items: CompositionCandidateDto[] }).items);
    } finally {
      setSearching(false);
    }
  }

  /**
   * その行に「残り」を入れる。合計がちょうど100%になる値を計算して埋める。
   * 他の行を直すたびに電卓を叩かずに済むよう、ダブルクリックで呼べるようにしてある。
   */
  function fillToHundred(index: number) {
    setRows((prev) => {
      if (!prev) return prev;
      const others = prev
        .filter((_, j) => j !== index)
        .map((r) => (r.isBalance ? null : r.contentPct || null));
      const rest = SCALED_HUNDRED - sumScaled(others);
      // 他の行だけで100%を超えているときは0にする（負の含有率は無い）
      const value = fromScaled(rest < 0n ? 0n : rest);
      return prev.map((r, j) => (j === index ? { ...r, contentPct: value, isBalance: false } : r));
    });
  }

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

  /** 選んだ候補をまとめて組成に足す */
  function addPicked() {
    const targets = (candidates ?? []).filter(
      (c) => picked.has(`${c.kind}:${c.id}`) && !alreadyAdded.has(`${c.kind}:${c.id}`),
    );
    if (targets.length === 0) return;
    setRows((prev) => [
      ...(prev ?? []),
      ...targets.map((c) => ({
        key: `new-${c.kind}-${c.id}`,
        kind: c.kind,
        element: {
          id: c.id,
          code: c.code,
          nameJa: c.nameJa,
          nameEn: c.nameEn,
          casNumber: c.casNumber,
        },
        contentPct: "",
        isBalance: false,
        note: "",
      })),
    ]);
    setPicked(new Set());
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
      onFinishEdit?.();
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

  // 全選択の対象は、まだ組成に入っていない候補だけ
  const selectable = useMemo(
    () => (candidates ?? []).filter((c) => !alreadyAdded.has(`${c.kind}:${c.id}`)),
    [candidates, alreadyAdded],
  );
  const allPicked =
    selectable.length > 0 && selectable.every((c) => picked.has(`${c.kind}:${c.id}`));

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
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">{m.composition.title}</CardTitle>
        {onRequestEdit &&
          canEdit &&
          (editing ? (
            <Badge variant="secondary">{m.common.editMode}</Badge>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={onRequestEdit}>
              <Pencil className="mr-1 size-3.5" />
              {m.common.edit}
            </Button>
          ))}
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
                  {/* 行の操作は、直しているときだけ出す */}
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
                          // 過去に打った文字が候補として出るのを止める
                          autoComplete="off"
                          title={m.composition.fillHint}
                          onDoubleClick={() => fillToHundred(i)}
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
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">{m.composition.searchTitle}</p>

            {/* 見出しはどれも短いので、左の列は詰める。説明は入力欄の右に添える */}
            <div className="grid gap-2 sm:grid-cols-[4rem_1fr]">
              <label htmlFor="cand-id" className="self-center text-right text-sm">
                {m.composition.elementId}
              </label>
              <Input
                ref={searchRef}
                id="cand-id"
                value={cond.id}
                onChange={(e) => setCond({ ...cond, id: e.target.value })}
                className="w-full sm:w-64"
              />

              <label htmlFor="cand-cas" className="self-center text-right text-sm">
                {m.composition.casNumber}
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  id="cand-cas"
                  value={cond.cas}
                  onChange={(e) => setCond({ ...cond, cas: e.target.value })}
                  className="w-full sm:w-64"
                />
                <p className="text-muted-foreground text-xs">{m.composition.casSearchHint}</p>
              </div>

              <label htmlFor="cand-name" className="self-center text-right text-sm">
                {m.composition.searchName}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="cand-name"
                  value={cond.name}
                  onChange={(e) => setCond({ ...cond, name: e.target.value })}
                  className="w-full sm:w-64"
                  autoComplete="off"
                />
                <select
                  aria-label={m.composition.nameOp}
                  value={cond.nameOp}
                  onChange={(e) => setCond({ ...cond, nameOp: e.target.value as TextOperator })}
                  className="border-input bg-background h-9 rounded-none border px-2 text-sm"
                >
                  {NAME_OPS.map((op) => (
                    <option key={op} value={op}>
                      {m.table.operators[op]}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={m.composition.nameScope}
                  value={cond.nameScope}
                  onChange={(e) => setCond({ ...cond, nameScope: e.target.value as NameScope })}
                  className="border-input bg-background h-9 rounded-none border px-2 text-sm"
                >
                  {NAME_SCOPES.map((sc) => (
                    <option key={sc} value={sc}>
                      {m.composition.nameScopes[sc]}
                    </option>
                  ))}
                </select>
              </div>

              <span className="self-center text-right text-sm">{m.composition.target}</span>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={cond.substance}
                    onChange={(e) => setCond({ ...cond, substance: e.target.checked })}
                  />
                  {m.composition.kindSubstance}
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={cond.product}
                    onChange={(e) => setCond({ ...cond, product: e.target.checked })}
                  />
                  {m.composition.kindProduct}
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" disabled={searching} onClick={() => void search()}>
                {searching ? m.composition.searching : m.common.search}
              </Button>
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
                <>
                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b text-left">
                          <th className={cn(CELL, "w-8 text-center")}>
                            {/* まとめて選ぶ。追加済みのものは対象にしない */}
                            <input
                              type="checkbox"
                              aria-label={m.composition.selectAll}
                              title={m.composition.selectAll}
                              disabled={full || selectable.length === 0}
                              checked={allPicked}
                              ref={(el) => {
                                if (el) el.indeterminate = !allPicked && picked.size > 0;
                              }}
                              onChange={(e) =>
                                setPicked(
                                  e.target.checked
                                    ? new Set(selectable.map((c) => `${c.kind}:${c.id}`))
                                    : new Set(),
                                )
                              }
                            />
                          </th>
                          <th className={cn(CELL, "w-28 font-medium")}>
                            {m.composition.elementId}
                          </th>
                          <th className={cn(CELL, "w-32 font-medium")}>
                            {m.composition.casNumber}
                          </th>
                          <th className={cn(CELL, "font-medium")}>{m.composition.elementName}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((c) => {
                          const key = `${c.kind}:${c.id}`;
                          const added = alreadyAdded.has(key);
                          return (
                            <tr key={key} className={cn("border-b", added && "opacity-50")}>
                              <td className={cn(CELL, "text-center")}>
                                <input
                                  type="checkbox"
                                  aria-label={c.code}
                                  disabled={added || full}
                                  checked={picked.has(key)}
                                  onChange={(e) => {
                                    const next = new Set(picked);
                                    if (e.target.checked) next.add(key);
                                    else next.delete(key);
                                    setPicked(next);
                                  }}
                                />
                              </td>
                              <td className={cn(CELL, "font-mono text-xs")}>{c.code}</td>
                              <td className={cn(CELL, "font-mono text-xs")}>
                                {c.casNumber ?? (
                                  <span className="text-muted-foreground font-sans">
                                    {m.composition.kindProduct}
                                  </span>
                                )}
                              </td>
                              <td className={CELL}>
                                {pickName(locale, c.nameJa, c.nameEn)}
                                {added && (
                                  <span className="text-muted-foreground ml-2 text-xs">
                                    {m.composition.alreadyAdded}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={picked.size === 0 || full}
                    onClick={addPicked}
                  >
                    {m.composition.addSelected(picked.size)}
                  </Button>
                </>
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
                setErrors([]);
                setNotice(null);
                onFinishEdit?.();
                void load();
              }}
            >
              {m.common.discard}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
