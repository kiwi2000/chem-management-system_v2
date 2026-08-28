"use client";

import {
  COMPOSITION_MAX_LINES,
  fromScaled,
  pickName,
  ratioOfPct,
  SCALED_HUNDRED,
  sumScaled,
  validateCompositionSum,
  type AppSettings,
  type TextOperator,
} from "@chem/shared";
import { FoldVertical, GripVertical, Pencil, Trash2, UnfoldVertical } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompositionAggregateTable } from "@/components/composition-aggregate-table";
import { CELL_CLIP } from "@/components/ui/table";
import { useResizableColumns } from "@/components/data-table/resizable-columns";
import {
  CompositionTreeRows,
  ExpandToggle,
  isFullyExpanded,
  useCompositionTree,
  type TreeRoot,
} from "@/components/composition-tree";
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

/** 長い語もセルの中で折り返す。折り返せないものは CELL_CLIP で隠れる */
const CELL = "border-r px-2 py-1 break-words last:border-r-0";

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
/** 行をつかんで並べ替えるつまみの列。中身の大きさで決まるので、伸び縮みさせない */
const DRAG_HANDLE_WIDTH = 32;
/** 行を消すボタンの列。同上 */
const ROW_ACTION_WIDTH = 44;

/**
 * 「展開」「閉じる」の組。表ごとに1つずつ置く。
 *
 * 表が2つ並ぶので、**どちらに効くのかはボタンの置き場所で示す。**
 * 1組を共有して「いま見えているほう」に効かせると、押すまで結果が分からない。
 */
function ExpandButtons({
  m,
  canExpand,
  canCollapse,
  onExpand,
  onCollapse,
}: {
  m: ReturnType<typeof useI18n>["m"];
  canExpand: boolean;
  canCollapse: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {/* もう全部開いているなら押せない（「閉じる」と揃える） */}
      <Button type="button" size="sm" variant="outline" disabled={!canExpand} onClick={onExpand}>
        <UnfoldVertical className="mr-1 size-3.5" />
        {m.composition.expandAll}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!canCollapse}
        onClick={onCollapse}
      >
        <FoldVertical className="mr-1 size-3.5" />
        {m.composition.collapseAll}
      </Button>
    </div>
  );
}

export function CompositionEditor({
  productId,
  settings,
  editing: editable,
  onRequestEdit,
  onFinishEdit,
}: Props) {
  const { m, locale } = useI18n();

  // 条件をクリアしたあと、ID欄へカーソルを戻すために持つ
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

  /**
   * 検索条件を初期に戻す。結果も一緒に消す。
   * 条件だけ消して前の結果が残ると、いま何を探した結果なのか分からなくなるため。
   */
  function clearSearch() {
    setCond({
      id: "",
      cas: "",
      name: "",
      nameOp: "contains",
      nameScope: "mainJa",
      substance: true,
      product: true,
    });
    setCandidates(null);
    setPicked(new Set());
    searchRef.current?.focus();
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
          hasComposition: c.hasComposition,
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

  // 原材料の中身を下ろして見せる。編集中は使わない（つまみと印が同じ場所を取り合うため）
  const tree = useCompositionTree();

  /**
   * 「原材料内」の列を出すか。
   * 開ける原材料が1つも無い組成では、いつまでも空のままなので列ごと出さない。
   * 編集中も展開できないので出さない。
   */
  const showWithin = !editing && (rows ?? []).some((r) => r.element.hasComposition);
  /**
   * CASでまとめた表に切り替えられるか。
   *
   * 原材料が1つも無く、同じCASの物質も重なっていなければ、まとめても同じ表になる。
   * その場合は切り替えを出さない（押しても何も変わらないタブは、迷わせるだけ）。
   * 原材料があれば、中身が登録されていなくても切り替えを出す。
   * 「判定に使える値が揃っていない」ことを知らせる場所が、まとめた表しか無いため。
   *
   * 判定は登録済みの行だけで済む。展開しないと分からない重複は、
   * 原材料がある時点でどのみち切り替えを出すので、見に行く必要がない。
   */
  const canAggregate = useMemo(() => {
    const list = rows ?? [];
    if (list.some((r) => r.kind === "product")) return true;
    const seen = new Set<string>();
    return list.some((r) => {
      const cas = r.element.casNumber?.trim().toUpperCase();
      if (!cas) return false;
      if (seen.has(cas)) return true;
      seen.add(cas);
      return false;
    });
  }, [rows]);
  /**
   * 合算表の開閉。見出しの「展開」「閉じる」から操るので、状態はここで持つ。
   * 鍵は合算表の側から受け取る（どの行が開けるかは、中身を取ってみないと分からない）。
   */
  const [aggregateOpen, setAggregateOpen] = useState<Set<string>>(new Set());
  const [aggregateKeys, setAggregateKeys] = useState<string[]>([]);
  /*
    列幅は一覧と同じ規則。
    **原材料内の重量%は、出ているときだけ数に入れる。**
    いつも数に入れると、出ていない製品でも幅を取られて他の列が狭くなる。
  */
  const extra = editing ? DRAG_HANDLE_WIDTH + ROW_ACTION_WIDTH : 0;
  const cols = useResizableColumns(
    // 版を上げて、覚えている列幅を捨てる（含有率の列を広げた既定で始め直す）
    "chem.table.composition.v2",
    [
      { key: "elementId", width: 88 },
      { key: "casNumber", width: 96 },
      { key: "elementName", width: 288 },
      // 含有率は小数第6位まで。「100.000001%」まで隠れずに入る幅にする
      { key: "contentPct", width: 104 },
      ...(showWithin ? [{ key: "withinPct", width: 104 }] : []),
      { key: "note", width: 160 },
    ],
    // 下の展開表と同じ規則。並べて見るので、片方だけ詰まると行がずれて見える
    { shrinkToFit: false },
  );
  /*
    まとめた表を下に並べるか。
    **直しているあいだは出さない。**書き換えている途中の値をまとめても意味が無く、
    保存するまで上下が食い違って見えるため。

    直していないときは**必ず出す**。まとめた表にしか「該当法規制」の列が無く、
    どの成分がどの規制に効いているかは、ここでしか見られない。
  */
  const showAggregate = !editing;
  /*
    登録したままの表を出すか。

    **まとめても同じ表になるなら、こちらを出さない。**中身が同じ表を2つ並べても
    読む手間が増えるだけで、残すなら列の多いまとめた表のほう。
    備考はまとめた表にも出るので、これで消える情報は無い。
  */
  const showRaw = editing || canAggregate;

  /** すべて展開の出発点。表に並んでいる、中身を持つ原材料の行 */
  const treeRoots: TreeRoot[] = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.element.hasComposition)
        .map((r) => ({ path: r.key, productId: r.element.id })),
    [rows],
  );
  /** 展開行が結合に使う列の数 */
  const columnCount = (editing ? 7 : 5) + (showWithin ? 1 : 0);

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
        {/* 編集を先に置く。展開のボタンは組成の中身によって出たり出なかったりするので、
          後ろに並べておくと「編集」の位置が動かない */}
        <div className="flex items-center gap-1">
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
          {/*
            開くものが無ければ置いても押せないので出さない。
            **ここは登録組成の木だけを操る。**まとめた表は自分の見出しに同じ組を持つ。
            2つの表が同時に見えているので、どちらに効くのか分からないボタンは置かない。
          */}
          {showWithin && (
            <ExpandButtons
              m={m}
              canExpand={!tree.expandingAll && !isFullyExpanded(tree, treeRoots)}
              canCollapse={tree.open.size > 0}
              onExpand={() => tree.expandAll(treeRoots)}
              onCollapse={() => tree.collapseAll()}
            />
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {rows === null ? (
          <p className="text-muted-foreground text-sm">{m.common.loading}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{m.composition.empty}</p>
        ) : !showRaw ? null : (
          <div ref={cols.scrollerRef} className="overflow-x-auto">
            <table
              {...cols.tableProps}
              className={cn(
                "table-fixed border-collapse text-sm",
                CELL_CLIP,
                cols.tableProps.className,
              )}
              // 直しているときだけ出る前後の列のぶんを足す
              style={{ width: (cols.tableProps.style.width ?? 0) + extra }}
            >
              {/*
                colgroup は列の並びと1対1で対応する。
                **直しているときだけ出る前後の列も、ここに置くこと。**
                置き忘れると、幅が1つずつずれて別の列に当たる。
              */}
              <colgroup>
                {editing && <col style={{ width: DRAG_HANDLE_WIDTH }} />}
                {cols.cols()}
                {editing && <col style={{ width: ROW_ACTION_WIDTH }} />}
              </colgroup>
              <thead>
                <tr className="bg-muted/50 border-y text-left">
                  {/* 行をつかんで並べ替えるためのつまみ。幅は固定（つまみの大きさで決まる） */}
                  {editing && <th className={cn(CELL, "w-8")} />}
                  <th className={cn(CELL, "relative font-medium")}>
                    {m.composition.elementId}
                    {cols.handle("elementId", `${m.composition.elementId} ${m.table.resize}`)}
                  </th>
                  <th className={cn(CELL, "relative font-medium")}>
                    {m.composition.casNumber}
                    {cols.handle("casNumber", `${m.composition.casNumber} ${m.table.resize}`)}
                  </th>
                  <th className={cn(CELL, "relative font-medium")}>
                    {m.composition.elementName}
                    {cols.handle("elementName", `${m.composition.elementName} ${m.table.resize}`)}
                  </th>
                  <th className={cn(CELL, "relative text-right font-medium whitespace-nowrap")}>
                    {m.composition.contentPct}
                    {/* 列が2つ並ぶときだけ、どちらの重量%かを添える */}
                    {showWithin && (
                      <span className="text-muted-foreground block text-xs font-normal">
                        {m.composition.pctOfProduct}
                      </span>
                    )}
                    {cols.handle("contentPct", `${m.composition.contentPct} ${m.table.resize}`)}
                  </th>
                  {showWithin && (
                    <th className={cn(CELL, "relative text-right font-medium whitespace-nowrap")}>
                      {m.composition.contentPct}
                      <span className="text-muted-foreground block text-xs font-normal">
                        {m.composition.pctWithinMaterial}
                      </span>
                      {cols.handle(
                        "withinPct",
                        `${m.composition.pctWithinMaterial} ${m.table.resize}`,
                      )}
                    </th>
                  )}
                  <th className={cn(CELL, "relative font-medium")}>
                    {m.composition.note}
                    {cols.handle("note", `${m.composition.note} ${m.table.resize}`)}
                  </th>
                  {/* 行の操作は、直しているときだけ出す。幅は中身で決まる */}
                  {editing && <th className={cn(CELL, "w-px")} />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Fragment key={r.key}>
                    <tr
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
                      <td className={cn(CELL, "font-mono text-xs")}>
                        {/* 中身を持つ原材料だけ開ける。編集中は出さない */}
                        {!editing && r.element.hasComposition ? (
                          <span className="inline-flex items-center gap-1">
                            <ExpandToggle
                              open={tree.open.has(r.key)}
                              onClick={() => tree.toggle(r.key, r.element.id)}
                              label={
                                tree.open.has(r.key) ? m.composition.collapse : m.composition.expand
                              }
                            />
                            {r.element.code}
                          </span>
                        ) : (
                          r.element.code
                        )}
                      </td>
                      <td className={cn(CELL, "font-mono text-xs")}>
                        {r.element.casNumber ?? (
                          // 原材料にCASは無い。値と紛れないよう淡い文字にする
                          <span className="text-muted-foreground font-sans">
                            {m.composition.kindProduct}
                          </span>
                        )}
                      </td>
                      <td className={CELL}>
                        {pickName(locale, r.element.nameJa, r.element.nameEn)}
                      </td>
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
                            className="h-8 w-20 text-right"
                          />
                        ) : (
                          r.contentPct
                        )}
                      </td>
                      {showWithin && (
                        // 登録した行には親の原材料が無いので、比べる相手がいない
                        <td className={cn(CELL, "text-muted-foreground text-right")}>—</td>
                      )}
                      <td className={CELL}>
                        {editing ? (
                          // 長い備考も読めるよう、下へ引っぱって広げられるようにする
                          <textarea
                            aria-label={`${r.element.code} ${m.composition.note}`}
                            maxLength={500}
                            rows={1}
                            value={r.note}
                            onChange={(e) => update(i, { note: e.target.value })}
                            className="border-input bg-background block min-h-8 w-full resize-y rounded-none border px-2 py-1 text-sm"
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">{r.note}</span>
                        )}
                      </td>
                      {editing && (
                        <td className={cn(CELL, "w-px px-1 text-center")}>
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
                    {!editing && r.element.hasComposition && (
                      <CompositionTreeRows
                        tree={tree}
                        path={r.key}
                        ratio={
                          ratioOfPct((r.isBalance ? sum.balancePct : r.contentPct) || "0") ?? {
                            num: 0n,
                            den: 1n,
                          }
                        }
                        parentName={pickName(locale, r.element.nameJa, r.element.nameEn)}
                        depth={1}
                        colSpan={columnCount}
                        showWithin={showWithin}
                        cellClass={CELL}
                      />
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 border-t">
                  {/* 合計は数字の真上に来るよう、重量%の1つ手前まで結合する */}
                  <td className={cn(CELL, "text-right font-medium")} colSpan={editing ? 4 : 3}>
                    {m.composition.sumLabel}
                  </td>
                  <td className={cn(CELL, "text-right font-medium")}>{grandTotalPct}%</td>
                  {/* 合計は登録した行のぶんだけ。原材料内の値は足し合わせても意味を持たない */}
                  {showWithin && <td className={CELL} />}
                  <td className={CELL} />
                  {/* 追加は下の「組成検索」で行うので、合計行に操作は置かない */}
                  {editing && <td className={CELL} />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/*
          まとめた表。**登録した組成の下に並べる。**
          上の表が「登録したそのまま」、下が「判定に使う値」。
          切り替えではなく並べるのは、**この2つを見比べたい場面が多い**ため
          （原材料の中に同じCASが散っているとき、上だけ見ても合計が分からない）。

          まとめても同じ表になるときは、**上の表のほうを出さない**（`showRaw`）。
          同じものを2つ並べても読む手間が増えるだけで、列の多いこちらを残す。
        */}
        {showAggregate && (
          /*
            上の表を出さないときは、区切り線も小見出しも要らない。
            まとめる相手がいないのだから「原材料展開・CAS合算」と名乗ると、
            **何かをまとめた表に見えてしまう**。札の「組成」がそのまま見出しになる
          */
          <div className={cn("space-y-2", showRaw && "border-t pt-4")}>
            {/*
              見出しとボタンの置き方は、上の「組成」の見出しと同じにする。
              左端がそろっていないと、2つの表が別のものに見える。
            */}
            <div className="space-y-1">
              {showRaw && <p className="text-sm font-medium">{m.composition.aggregateTitle}</p>}
              {aggregateKeys.length > 0 && (
                <ExpandButtons
                  m={m}
                  canExpand={!aggregateKeys.every((k) => aggregateOpen.has(k))}
                  canCollapse={aggregateOpen.size > 0}
                  onExpand={() => setAggregateOpen(new Set(aggregateKeys))}
                  onCollapse={() => setAggregateOpen(new Set())}
                />
              )}
            </div>
            <CompositionAggregateTable
              productId={productId}
              open={aggregateOpen}
              onOpenChange={setAggregateOpen}
              onExpandableChange={setAggregateKeys}
            />
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
              <Button type="button" size="sm" variant="outline" onClick={clearSearch}>
                {m.table.clear}
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
                    <table className={cn("w-full border-collapse text-sm", CELL_CLIP)}>
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
