"use client";

import {
  BLOCK_KINDS,
  fieldsFor,
  groupIntoRows,
  tablesFor,
  type BlockKind,
  type DocumentBlock,
  type DocumentTable,
  type DocumentTarget,
} from "@chem/shared";
import { GripVertical, Trash2 } from "lucide-react";
import { useState } from "react";
import { RichEditor } from "@/components/doc-editor/rich-editor";
import { TableBlockFields } from "@/components/doc-editor/table-block-fields";
import { WidthSelect } from "@/components/doc-editor/width-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

const SELECT = "border-input h-8 rounded-none border bg-transparent px-2 text-sm";

/** 新しいブロックの中身。種類ごとの初期値 */
function newBlock(kind: BlockKind, target: DocumentTarget, id: string): DocumentBlock {
  switch (kind) {
    case "heading":
      return { id, kind, level: 2, lines: [{ spans: [] }] };
    case "text":
      return { id, kind, lines: [{ spans: [] }] };
    case "fields":
      return { id, kind, items: [] };
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
      return { id, kind, size: "md" };
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
}: {
  blocks: DocumentBlock[];
  target: DocumentTarget;
  /** 会社の自由項目の名前 */
  orgItems: string[];
  onChange: (next: DocumentBlock[]) => void;
}) {
  const { m, locale } = useI18n();
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
    onChange([...blocks, newBlock(kind, target, id)]);
  }

  return (
    <div className="space-y-3">
      {blocks.length === 0 && <p className="text-muted-foreground text-sm">{m.docEditor.empty}</p>}

      {/*
        **編集画面でも、出てくる紙と同じ形に並べる。**
        幅を選んだのに縦に積んだまま見せると、刷るまで結果が分からない
      */}
      {groupIntoRows(blocks).map((row, r) => (
        <div key={r} className={row.blocks.length > 1 ? "flex items-start gap-3" : undefined}>
          {row.blocks.map((b, k) =>
            renderBlock(b, row.index[k]!, row.blocks.length > 1 ? row.percents[k]! : null),
          )}
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

  /** `pct` は、横に並んでいるときだけ入る（その行で実際に使う％） */
  function renderBlock(b: DocumentBlock, i: number, pct: number | null) {
    return (
      <div
        key={b.id}
        style={pct === null ? undefined : { width: `${pct}%` }}
        className={cn(
          "border-input rounded-none border",
          overIndex === i && dragIndex !== null && "border-primary border-t-2",
          dragIndex === i && "opacity-50",
        )}
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
        <div className="bg-muted/50 flex items-center gap-2 px-2 py-1">
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
          <span className="text-sm font-medium">{m.docEditor.blockKinds[b.kind]}</span>
          {/*
              幅。**改ページと改行は幅を持てない**（必ず1行を占めるので、選ばせても効かない）
            */}
          {b.kind !== "pageBreak" && b.kind !== "rowBreak" && (
            <WidthSelect
              key={b.id}
              value={b.width}
              onChange={(width) => replace(i, { ...b, width })}
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
              <label className="flex items-center gap-2 text-sm">
                {m.docEditor.headingLevel}
                <select
                  className={SELECT}
                  value={b.level}
                  onChange={(e) => replace(i, { ...b, level: Number(e.target.value) as 1 | 2 | 3 })}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
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
                    className="h-8 w-40"
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
              <select
                className={SELECT}
                value={b.size}
                onChange={(e) => replace(i, { ...b, size: e.target.value as "sm" | "md" | "lg" })}
              >
                {(["sm", "md", "lg"] as const).map((s) => (
                  <option key={s} value={s}>
                    {m.docEditor.spacerSizes[s]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {b.kind === "signature" && (
            <Input
              className="h-8 w-64"
              aria-label={m.docEditor.label}
              placeholder={m.docEditor.label}
              value={b.label}
              onChange={(e) => replace(i, { ...b, label: e.target.value })}
            />
          )}

          {(b.kind === "divider" || b.kind === "pageBreak" || b.kind === "rowBreak") && (
            <p className="text-muted-foreground text-sm">{m.docEditor.blockKinds[b.kind]}</p>
          )}
        </div>
      </div>
    );
  }
}
