"use client";

import {
  BLOCK_KINDS,
  DEFAULT_FONT,
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
  type DocumentTarget,
  type FontKey,
  type OrganisationKind,
  type OrgBlockItem,
  type OrgBlockMode,
} from "@chem/shared";
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from "lucide-react";
import { useState, useMemo } from "react";
import { RichEditor } from "@/components/doc-editor/rich-editor";
import { TableBlockFields } from "@/components/doc-editor/table-block-fields";
import { BlockStyleBar } from "@/components/doc-editor/block-style-bar";
import { WidthSelect } from "@/components/doc-editor/width-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-client";
import { useOrganisations } from "@/lib/use-organisations";
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
  documentFont,
  onChange,
}: {
  blocks: DocumentBlock[];
  target: DocumentTarget;
  /** 会社の自由項目の名前 */
  orgItems: string[];
  /** 紙面ぜんたいで選ばれている書体。ブロック側の「指定なし」に出す */
  documentFont?: FontKey;
  onChange: (next: DocumentBlock[]) => void;
}) {
  const { m, locale } = useI18n();
  /** ブロックで書体を選んでいないときに、何が使われるかを見せる */
  // 紙面ぜんたいで選ばれていなくても、実際に出るのはゴシック。その名前を見せる
  const defaultFontLabel = m.docEditor.fonts[documentFont ?? DEFAULT_FONT];
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
          {/*
            そのブロック全体の字。**どの種類でも変えられる。**
            文章と見出しは、この上に文字ごとの指定を重ねられる（そちらが勝つ）
          */}
          {b.kind !== "pageBreak" && b.kind !== "rowBreak" && b.kind !== "spacer" && (
            <BlockStyleBar
              value={b.style}
              onChange={(style) => replace(i, { ...b, style })}
              defaultFontLabel={defaultFontLabel}
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
                      className="h-8 w-40"
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
