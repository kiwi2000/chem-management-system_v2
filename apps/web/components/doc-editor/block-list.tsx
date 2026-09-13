"use client";

import {
  BLOCK_KINDS,
  DEFAULT_BLOCK_MARGIN,
  effectiveMargin,
  HEADING_LEVELS,
  ownFontSize,
  spacerMm,
  fieldsFor,
  groupIntoRows,
  ORG_NAME_ITEM,
  ORGANISATION_KINDS,
  orgBlockMode,
  pickName,
  tablesFor,
  type BlockKind,
  type DocumentBlock,
  type DocumentTable,
  type HeadingLevel,
  type DocumentTarget,
  type OrganisationKind,
  type OrgBlockItem,
  type OrgBlockMode,
  type BlockMargin,
} from "@chem/shared";
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { RichEditor } from "@/components/doc-editor/rich-editor";
import { TableBlockFields } from "@/components/doc-editor/table-block-fields";
import { BlockStyleBar } from "@/components/doc-editor/block-style-bar";
import { FontSizeInput } from "@/components/doc-editor/font-size-input";
import { WidthSelect } from "@/components/doc-editor/width-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-client";
import { useOrganisations } from "@/lib/use-organisations";
import { cn } from "@/lib/utils";

/** 余白の高さ（mm）の候補 */
const SPACER_PRESETS = [2, 4, 6, 8, 10, 15, 20, 30, 40, 50] as const;

const SELECT = "border-input h-7 rounded-none border bg-transparent px-2 text-sm";

/** 新しいブロックの中身。種類ごとの初期値 */
function newBlock(kind: BlockKind, target: DocumentTarget, id: string): DocumentBlock {
  switch (kind) {
    case "heading":
      return { id, kind, level: 2, lines: [{ spans: [] }] };
    case "text":
      return { id, kind, lines: [{ spans: [] }] };
    case "fields":
      return { id, kind, items: [] };
    // 組織は選んでもらう。空のまま置いても紙面には何も出ない
    case "org":
      return { id, kind, organisationId: "", items: [] };
    case "table": {
      const first = tablesFor(target)[0];
      return {
        id,
        kind,
        table: (first?.key ?? "composition") as DocumentTable,
        columns: first?.columns.map((c) => c.key) ?? [],
      };
    }
    case "spacer":
      return { id, kind, size: 8 };
    case "signature":
      return { id, kind, label: "" };
    default:
      return { id, kind } as DocumentBlock;
  }
}

/**
 * ブロックを縦に並べて編集する。
 *
 * **上から積むだけ。**自由に置けるキャンバスにはしない。
 * 帳票は「決まった様式に決まったデータを流す」ものなので、
 * 置き場所の自由より、崩れないことのほうが要る。
 */
export function BlockList({
  blocks,
  target,
  orgItems,
  onChange,
  onActivate,
  activeIds = [],
}: {
  blocks: DocumentBlock[];
  target: DocumentTarget;
  /** 会社の自由項目の名前 */
  orgItems: string[];
  onChange: (next: DocumentBlock[]) => void;
  /** 選んでいるブロックの id の並びを知らせる（空は選択なし）。プレビューでそのブロックを枠で示すため */
  onActivate?: (ids: string[]) => void;
  /** いま選んでいるブロック（複数可）。プレビューの赤い枠と同じ色で、編集側の枠も赤くする（2026-09-13 指示） */
  activeIds?: readonly string[];
}) {
  const { m, locale } = useI18n();
  /** Shift で範囲を選ぶときの起点。最後にふつうに押したブロック */
  const anchorId = useRef<string | null>(null);
  /**
   * 押したブロックをどう選ぶか（2026-09-13 指示：複数選べるように）。
   * - ふつうに押す: そのブロックだけ。すでにそれだけを選んでいて、欄でないところなら外す
   * - Ctrl（Mac は ⌘）を押しながら: 足す／外す
   * - Shift を押しながら: 起点からそこまでの範囲
   */
  const pick = (
    id: string,
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    onControl: boolean,
  ) => {
    const cur = activeIds;
    if (e.shiftKey && anchorId.current) {
      const a = blocks.findIndex((x) => x.id === anchorId.current);
      const b = blocks.findIndex((x) => x.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        onActivate?.(blocks.slice(lo, hi + 1).map((x) => x.id));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      anchorId.current = id;
      onActivate?.(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
      return;
    }
    anchorId.current = id;
    if (!onControl && cur.length === 1 && cur[0] === id) onActivate?.([]);
    else onActivate?.([id]);
  };
  /*
    組織ブロックの選択肢。**一覧はログインしていれば誰でも引ける。**
    自分の会社・部署も、取引先も同じ表にあるので、ここで分けない
  */
  const organisations = useOrganisations();
  /** その組織が持っている項目名。組織を選び直したら、選べる項目も変わる */
  /** 種別の呼び名。画面の言語で出す */
  const kindNames = useMemo(
    () => ({
      COMPANY: m.organisations.kindCompany,
      DEPARTMENT: m.organisations.kindDepartment,
      PARTNER: m.organisations.kindPartner,
      OTHER: m.organisations.kindOther,
    }),
    [m],
  );
  /*
    組織ブロックで選べる項目名。**組織を決めてあればその組織の項目、
    決めていなければ候補になる組織すべての項目名を重複なしで並べる**
    （生成するときにどれが選ばれても、様式で並べた項目が引ける）
  */
  const itemsFor = (b: { organisationId: string; organisationKind?: OrganisationKind }) => {
    const all = organisations ?? [];
    const pool = b.organisationId
      ? all.filter((o) => o.id === b.organisationId)
      : all.filter((o) => o.activeFlag && (!b.organisationKind || o.kind === b.organisationKind));
    return [...new Set(pool.flatMap((o) => o.items.map((x) => x.label)))];
  };

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const replace = (i: number, block: DocumentBlock) =>
    onChange(blocks.map((b, j) => (j === i ? block : b)));

  const remove = (i: number) => onChange(blocks.filter((_, j) => j !== i));

  /** 位置を入れ替える。つかめない人のために矢印キーからも呼ぶ */
  function move(from: number, delta: number) {
    const to = from + delta;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    onChange(next);
  }

  function add(kind: BlockKind) {
    // id は消したり並べ替えたりの目印。中身とは関わらない
    const id = `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    // 余白は4辺とも書き込む。欄に出ている値がそのまま使われる（2026-09-13 決定）
    onChange([...blocks, { ...newBlock(kind, target, id), margin: { ...DEFAULT_BLOCK_MARGIN } }]);
  }

  return (
    <div className="space-y-3">
      {blocks.length === 0 && <p className="text-muted-foreground text-sm">{m.docEditor.empty}</p>}

      {/*
        **編集画面でも、出てくる紙と同じ形に並べる。**
        幅を選んだのに縦に積んだまま見せると、刷るまで結果が分からない
      */}
      {groupIntoRows(blocks).map((row, r) => (
        <div
          key={r}
          className={row.blocks.length > 1 ? "flex flex-wrap items-start gap-3" : undefined}
        >
          {row.blocks.map((b, k) => renderBlock(b, row.index[k]!))}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {BLOCK_KINDS.map((k) => (
          <Button key={k} type="button" size="sm" variant="outline" onClick={() => add(k)}>
            ＋ {m.docEditor.blockKinds[k]}
          </Button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{m.docEditor.widthHint}</p>
    </div>
  );

  function renderBlock(b: DocumentBlock, i: number) {
    return (
      <div
        key={b.id}
        /*
          **編集の枠は、中身がちょうど入る幅にする。**
          紙面の割合に合わせて細くしていたころは、細くするほど操作欄がはみ出し、
          しまいには幅の選択欄にも手が届かなくなった（実際にそうなった）。
          刷ったときの割合は、右のプレビューで確かめられる
        */
        className={cn(
          "border-input rounded-none border",
          // 選んでいるブロック。プレビューの赤い枠と対で分かるように、こちらも赤い枠にする
          activeIds.includes(b.id) && "border-red-600 ring-1 ring-red-600",
          overIndex === i && dragIndex !== null && "border-primary border-t-2",
          dragIndex === i && "opacity-50",
        )}
        /*
          押した・打ち込んだブロックを「選んでいる」とみなす。プレビューの赤い枠がそこに付く。
          選んでいるブロックの余白（欄やボタンでないところ）をもう一度押すと選択を外す（2026-09-13 指示）。
          欄の中を押したときは外さない（打ち込みの途中で枠が消えないように）
        */
        onMouseDownCapture={(e) => {
          const el = e.target as HTMLElement;
          const onControl = !!el.closest(
            "input, select, textarea, button, a, [contenteditable], .ProseMirror",
          );
          pick(b.id, e, onControl);
        }}
        // キーで欄に入ったとき。すでに選んでいる中の1つなら、複数の選択を崩さない
        onFocusCapture={() => {
          if (!activeIds.includes(b.id)) onActivate?.([b.id]);
        }}
        onDragOver={
          dragIndex === null
            ? undefined
            : (e) => {
                e.preventDefault();
                setOverIndex(i);
              }
        }
        onDrop={
          dragIndex === null
            ? undefined
            : (e) => {
                e.preventDefault();
                if (dragIndex !== i) move(dragIndex, i - dragIndex);
                setDragIndex(null);
                setOverIndex(null);
              }
        }
      >
        <div className="bg-muted/50 flex flex-wrap items-end gap-x-1.5 gap-y-1 px-2 py-1">
          <button
            type="button"
            draggable
            aria-label={m.docEditor.reorderHint}
            title={m.docEditor.reorderHint}
            className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
            onDragStart={(e) => {
              setDragIndex(i);
              e.dataTransfer.effectAllowed = "move";
              // Firefox は中身が空だと運べない
              e.dataTransfer.setData("text/plain", String(i));
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              move(i, e.key === "ArrowUp" ? -1 : 1);
            }}
          >
            <GripVertical className="size-4" />
          </button>
          <span className="shrink-0 text-sm font-medium whitespace-nowrap">
            {m.docEditor.blockKinds[b.kind]}
          </span>
          {/*
            見出しレベル（1〜6）。目次や番号付けで階層を表すためのもので、
            字の大きさを指定していないときの既定の大きさもここで決まる（指定すればそちらが勝つ）。
            見出しの名前のすぐ右に置く（2026-09-13 指示）
          */}
          {b.kind === "heading" && (
            <Labeled label={m.docEditor.headingLevelShort}>
              <select
                className={SELECT}
                aria-label={m.docEditor.headingLevel}
                value={b.level}
                onChange={(e) =>
                  replace(i, { ...b, level: Number(e.target.value) as HeadingLevel })
                }
              >
                {HEADING_LEVELS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Labeled>
          )}
          {/*
              幅。**改ページと改行は幅を持てない**（必ず1行を占めるので、選ばせても効かない）
            */}
          {b.kind !== "pageBreak" && b.kind !== "rowBreak" && (
            <Labeled label={m.docEditor.width}>
              <WidthSelect
                key={b.id}
                value={b.width}
                onChange={(width) => replace(i, { ...b, width })}
              />
            </Labeled>
          )}
          {/*
            そのブロック全体の字。**どの種類でも変えられる。**
            文章と見出しは、この上に文字ごとの指定を重ねられる（そちらが勝つ）
          */}
          {b.kind !== "pageBreak" && b.kind !== "rowBreak" && b.kind !== "spacer" && (
            <BlockStyleBar
              value={b.style}
              onChange={(style) => replace(i, { ...b, style })}
              defaultFontLabel={m.docEditor.fontDefaultShort}
              fontLabel={m.docEditor.font}
              defaultSize={ownFontSize(b)}
            />
          )}
          {/* 余白（mm）。紙の端や隣のブロックからの間を、辺ごとに決める（2026-09-13 指示） */}
          {b.kind !== "pageBreak" && b.kind !== "rowBreak" && (
            <MarginInputs
              value={effectiveMargin(b.kind, b.margin)}
              onChange={(margin) => replace(i, { ...b, margin })}
              label={m.docEditor.margin}
              sides={m.docEditor.marginSides}
              hint={m.docEditor.marginHint}
            />
          )}
          <div className="ml-auto">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={m.docEditor.remove}
              title={m.docEditor.remove}
              onClick={() => remove(i)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-2 p-2">
          {b.kind === "heading" && (
            <>
              <RichEditor
                value={b.lines}
                target={target}
                orgItems={orgItems}
                minHeight="2.5rem"
                onChange={(lines) => replace(i, { ...b, lines })}
              />
            </>
          )}

          {b.kind === "text" && (
            <RichEditor
              value={b.lines}
              target={target}
              orgItems={orgItems}
              onChange={(lines) => replace(i, { ...b, lines })}
            />
          )}

          {b.kind === "fields" && (
            <div className="space-y-2">
              {b.items.map((it, k) => (
                <div key={k} className="flex flex-wrap items-center gap-2">
                  <Input
                    className="h-7 w-40"
                    aria-label={m.docEditor.label}
                    placeholder={m.docEditor.label}
                    value={it.label}
                    onChange={(e) => {
                      const items = b.items.map((x, j) =>
                        j === k ? { ...x, label: e.target.value } : x,
                      );
                      replace(i, { ...b, items });
                    }}
                  />
                  <select
                    className={cn(SELECT, "w-56")}
                    aria-label={m.docEditor.field}
                    value={it.field}
                    onChange={(e) => {
                      const items = b.items.map((x, j) =>
                        j === k ? { ...x, field: e.target.value } : x,
                      );
                      replace(i, { ...b, items });
                    }}
                  >
                    <option value="">—</option>
                    {fieldsFor(target, orgItems).map((f) => (
                      <option key={f.key} value={f.key}>
                        {locale === "en" ? f.labelEn : f.labelJa}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={m.common.delete}
                    onClick={() => replace(i, { ...b, items: b.items.filter((_, j) => j !== k) })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => replace(i, { ...b, items: [...b.items, { label: "", field: "" }] })}
              >
                {m.docEditor.addItem}
              </Button>
              {/* ラベルだけの字と、ラベルと値の間。値の字はブロックの帯で決める（2026-09-13 指示） */}
              <div className="flex flex-wrap items-center gap-3 border-t pt-2">
                <span className="text-sm">{m.docEditor.fieldsLabelStyle}</span>
                <BlockStyleBar
                  value={b.labelStyle}
                  onChange={(labelStyle) => replace(i, { ...b, labelStyle })}
                  defaultFontLabel={m.docEditor.fieldsLabelFollow}
                />
                <label className="flex items-center gap-2 text-sm">
                  {m.docEditor.fieldsValueAlign}
                  <select
                    className={SELECT}
                    value={b.valueAlign ?? "left"}
                    onChange={(e) =>
                      replace(i, {
                        ...b,
                        valueAlign: e.target.value === "right" ? "right" : undefined,
                      })
                    }
                  >
                    <option value="left">{m.docEditor.fieldsValueAligns.left}</option>
                    <option value="right">{m.docEditor.fieldsValueAligns.right}</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  {m.docEditor.fieldsGap}
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step={0.5}
                    title={m.docEditor.fieldsGapHint}
                    placeholder="6"
                    className={cn(SELECT, "w-20 text-right")}
                    value={b.gap ?? ""}
                    onChange={(e) => {
                      if (e.target.value === "") {
                        replace(i, { ...b, gap: undefined });
                        return;
                      }
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      replace(i, { ...b, gap: Math.min(100, Math.max(0, n)) });
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {b.kind === "org" && (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">{m.docEditor.orgBlockHint}</p>
              {/*
                組織の決めかた。**様式で決めるか、種別だけ決めるか、生成するときに選ぶか。**
                「組織を決めておく」に切り替えたときは先頭の組織を入れておく
                （空のままだと「生成するときに選ぶ」と区別が付かない）
              */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className={cn(SELECT, "w-64")}
                  aria-label={m.docEditor.orgBlockMode}
                  value={orgBlockMode(b)}
                  onChange={(e) => {
                    const mode = e.target.value as OrgBlockMode;
                    const first = (organisations ?? []).find((o) => o.activeFlag)?.id ?? "";
                    replace(i, {
                      ...b,
                      organisationId: mode === "fixed" ? first : "",
                      organisationKind:
                        mode === "kind" ? (b.organisationKind ?? "COMPANY") : undefined,
                    });
                  }}
                >
                  <option value="any">{m.docEditor.orgBlockModeAny}</option>
                  <option value="kind">{m.docEditor.orgBlockModeKind}</option>
                  <option value="fixed">{m.docEditor.orgBlockModeFixed}</option>
                </select>
                {orgBlockMode(b) === "kind" && (
                  <select
                    className={cn(SELECT, "w-40")}
                    aria-label={m.docEditor.orgBlockKind}
                    value={b.organisationKind ?? "COMPANY"}
                    onChange={(e) =>
                      replace(i, { ...b, organisationKind: e.target.value as OrganisationKind })
                    }
                  >
                    {ORGANISATION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {kindNames[k]}
                      </option>
                    ))}
                  </select>
                )}
                {orgBlockMode(b) === "fixed" && (
                  <select
                    className={cn(SELECT, "w-56")}
                    aria-label={m.docEditor.orgBlockOrganisation}
                    value={b.organisationId}
                    onChange={(e) => replace(i, { ...b, organisationId: e.target.value })}
                  >
                    {(organisations ?? [])
                      .filter((o) => o.activeFlag || o.id === b.organisationId)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {pickName(locale, o.nameJa, o.nameEn)}
                        </option>
                      ))}
                  </select>
                )}
              </div>

              {b.items.map((it, k) => {
                const patch = (next: Partial<OrgBlockItem>) =>
                  replace(i, {
                    ...b,
                    items: b.items.map((x, j) => (j === k ? { ...x, ...next } : x)),
                  });
                return (
                  <div key={k} className="flex flex-wrap items-center gap-2">
                    {/* どの項目を出すか */}
                    <select
                      className={cn(SELECT, "w-48")}
                      aria-label={m.docEditor.orgBlockItem}
                      value={it.item}
                      onChange={(e) => patch({ item: e.target.value })}
                    >
                      <option value="">—</option>
                      {/* 名称は項目と同じ並びから選ばせる。名前だけの欄を別に作らない */}
                      <option value={ORG_NAME_ITEM}>{m.docEditor.orgBlockName}</option>
                      {itemsFor(b).map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {/*
                      紙に出す見出し。**組織側の項目名とは別に持つ。**
                      空にすれば値だけが出る（宛名や差出人の並びに使う）
                    */}
                    <Input
                      className="h-7 w-40"
                      aria-label={m.docEditor.orgBlockLabel}
                      placeholder={m.docEditor.orgBlockLabelPlaceholder}
                      value={it.label ?? ""}
                      onChange={(e) => patch({ label: e.target.value })}
                    />
                    {/* 行の寄せ。宛名は左、差出人は右、といった置き分けのため */}
                    <select
                      className={cn(SELECT, "w-28")}
                      aria-label={m.docEditor.orgBlockAlign}
                      value={it.align ?? "left"}
                      onChange={(e) => patch({ align: e.target.value as OrgBlockItem["align"] })}
                    >
                      <option value="left">{m.docEditor.alignLeft}</option>
                      <option value="center">{m.docEditor.alignCenter}</option>
                      <option value="right">{m.docEditor.alignRight}</option>
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={m.organisations.moveUp}
                      title={m.organisations.moveUp}
                      disabled={k === 0}
                      onClick={() => {
                        const items = [...b.items];
                        const [moved] = items.splice(k, 1);
                        if (moved) items.splice(k - 1, 0, moved);
                        replace(i, { ...b, items });
                      }}
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={m.organisations.moveDown}
                      title={m.organisations.moveDown}
                      disabled={k === b.items.length - 1}
                      onClick={() => {
                        const items = [...b.items];
                        const [moved] = items.splice(k, 1);
                        if (moved) items.splice(k + 1, 0, moved);
                        replace(i, { ...b, items });
                      }}
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={m.common.delete}
                      onClick={() => replace(i, { ...b, items: b.items.filter((_, j) => j !== k) })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => replace(i, { ...b, items: [...b.items, { item: "" }] })}
              >
                {m.docEditor.orgBlockAddItem}
              </Button>
            </div>
          )}

          {b.kind === "table" && (
            <TableBlockFields
              block={b}
              target={target}
              locale={locale}
              onChange={(next) => replace(i, next)}
            />
          )}

          {b.kind === "spacer" && (
            <label className="flex items-center gap-2 text-sm">
              {m.docEditor.spacerSize}
              {/* 高さは mm で打ち込む（▼ で候補）。古い様式の小・中・大は 4・8・16 mm として出る */}
              <FontSizeInput
                value={spacerMm(b.size)}
                onChange={(n) => {
                  if (n === undefined) return;
                  replace(i, { ...b, size: Math.min(200, Math.max(1, n)) });
                }}
                label={m.docEditor.spacerSizeHint}
                presets={SPACER_PRESETS}
                min={1}
                max={200}
                className={cn(SELECT, "w-20 text-right")}
              />
            </label>
          )}

          {b.kind === "signature" && (
            <div className="flex flex-wrap items-center gap-3">
              <Input
                className="h-7 w-64"
                aria-label={m.docEditor.label}
                placeholder={m.docEditor.label}
                value={b.label}
                onChange={(e) => replace(i, { ...b, label: e.target.value })}
              />
              {/* ラベルと線の置きかた・間・線の長さ（2026-09-13 指示） */}
              <label className="flex items-center gap-2 text-sm">
                {m.docEditor.signatureLabelPosition}
                <select
                  className={SELECT}
                  value={b.labelPosition ?? "left"}
                  onChange={(e) =>
                    replace(i, {
                      ...b,
                      labelPosition: e.target.value === "above" ? "above" : undefined,
                    })
                  }
                >
                  <option value="left">{m.docEditor.signatureLabelPositions.left}</option>
                  <option value="above">{m.docEditor.signatureLabelPositions.above}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                {m.docEditor.signatureGap}
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.5}
                  placeholder="4"
                  className={cn(SELECT, "w-20 text-right")}
                  value={b.gap ?? ""}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      replace(i, { ...b, gap: undefined });
                      return;
                    }
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    replace(i, { ...b, gap: Math.min(100, Math.max(0, n)) });
                  }}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                {m.docEditor.signatureLineWidth}
                <input
                  type="number"
                  inputMode="decimal"
                  min={5}
                  max={200}
                  step={1}
                  placeholder="60"
                  className={cn(SELECT, "w-20 text-right")}
                  value={b.lineWidth ?? ""}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      replace(i, { ...b, lineWidth: undefined });
                      return;
                    }
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    replace(i, { ...b, lineWidth: Math.min(200, Math.max(5, n)) });
                  }}
                />
              </label>
            </div>
          )}

          {(b.kind === "divider" || b.kind === "pageBreak" || b.kind === "rowBreak") && (
            <p className="text-muted-foreground text-sm">{m.docEditor.blockKinds[b.kind]}</p>
          )}
        </div>
      </div>
    );
  }
}

/**
 * ブロックの余白（mm）を辺ごとに打つ欄。空なら既定のまま。
 * 4つとも空になったら余白の指定そのものを外す（保存した様式に空の入れものを残さない）
 */
function MarginInputs({
  value,
  onChange,
  label,
  sides,
  hint,
}: {
  /** いま使っている余白（4辺とも入っている） */
  value: Required<BlockMargin>;
  onChange: (next: Required<BlockMargin>) => void;
  label: string;
  sides: { top: string; right: string; bottom: string; left: string };
  hint: string;
}) {
  /*
    欄に出ている値がそのまま使われる（2026-09-13 決定）。空にしたら 0。
    一度触ったら4辺とも書き込むので、古いブロックもそれ以降は種類ごとの補いを通らない
  */
  const set = (side: keyof BlockMargin, raw: string) => {
    const n = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n)) return;
    onChange({ ...value, [side]: Math.min(100, Math.max(0, n)) });
  };
  // 欄の上に「上」「下」「左」「右」だけを小さく出す（2026-09-13 指示。左に名前は置かない）
  return (
    <div className="flex items-end gap-1" title={hint}>
      {(["top", "bottom", "left", "right"] as const).map((side) => (
        <Labeled key={side} label={sides[side]} center>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.5}
            aria-label={`${label} ${sides[side]}`}
            className="border-input h-7 w-10 rounded-none border bg-transparent px-1 text-right text-xs"
            value={value[side]}
            onChange={(e) => set(side, e.target.value)}
          />
        </Labeled>
      ))}
    </div>
  );
}

/** 欄の上に小さく名前を出す入れもの。見出し行の欄はすべてこの形にそろえる（2026-09-13 指示） */
export function Labeled({
  label,
  children,
  center = false,
}: {
  label: string;
  children: React.ReactNode;
  /** 名前を欄の中央にそろえる（余白の 上・下・左・右。2026-09-13 指示） */
  center?: boolean;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span
        className={cn("text-muted-foreground text-[10px] leading-none", center && "text-center")}
      >
        {label}
      </span>
      {children}
    </span>
  );
}
