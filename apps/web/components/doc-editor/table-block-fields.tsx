"use client";

import {
  TABLE_FILTER_OPS,
  tablesFor,
  type DocumentBlock,
  type DocumentTable,
  type DocumentTarget,
  type Locale,
  type TableFilterOp,
} from "@chem/shared";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

const SELECT = "border-input h-8 rounded-none border bg-transparent px-2 text-sm";

type TableBlock = Extract<DocumentBlock, { kind: "table" }>;

/**
 * 表のブロックの設定。
 *
 * 上から**表題 → 出す表 → 出す列 → 絞り込み → 置き換え**の順に置く。
 * 表題がいちばん上なのは、紙面でもそこに出るため。
 * 画面の並びと紙面の並びを揃えておくと、どれを直しているのか迷わない。
 */
export function TableBlockFields({
  block: b,
  target,
  locale,
  onChange,
}: {
  block: TableBlock;
  target: DocumentTarget;
  locale: Locale;
  onChange: (next: TableBlock) => void;
}) {
  const { m } = useI18n();
  const def = tablesFor(target).find((t) => t.key === b.table);
  const all = def?.columns ?? [];
  const labelOf = (key: string) => {
    const c = all.find((x) => x.key === key);
    return c ? (locale === "en" ? c.labelEn : c.labelJa) : key;
  };

  /** 出していない列は、定義の順で後ろに並べる（選ぶときに探しやすい） */
  const ordered = [
    ...b.columns.filter((k) => all.some((c) => c.key === k)),
    ...all.map((c) => c.key).filter((k) => !b.columns.includes(k)),
  ];

  function move(key: string, dir: -1 | 1) {
    const cur = [...b.columns];
    const at = cur.indexOf(key);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= cur.length) return;
    [cur[at], cur[to]] = [cur[to]!, cur[at]!];
    onChange({ ...b, columns: cur });
  }

  const filters = b.filters ?? [];
  const replacements = b.replacements ?? [];

  return (
    <div className="space-y-3">
      {/* 表題。紙面でも表の上に出るので、設定もいちばん上に置く */}
      <Input
        className="h-8"
        aria-label={m.docEditor.caption}
        placeholder={m.docEditor.caption}
        value={b.caption ?? ""}
        onChange={(e) => onChange({ ...b, caption: e.target.value || undefined })}
      />

      <label className="flex items-center gap-2 text-sm">
        {m.docEditor.tableSource}
        <select
          className={cn(SELECT, "w-64")}
          value={b.table}
          onChange={(e) => {
            const table = e.target.value as DocumentTable;
            const next = tablesFor(target).find((t) => t.key === table);
            /*
              表を変えたら、列も絞り込みも置き換えも捨てる。
              前の表の列を指したまま残ると、当たらない条件だけがぶら下がる
            */
            onChange({
              ...b,
              table,
              columns: next?.columns.map((c) => c.key) ?? [],
              filters: undefined,
              replacements: undefined,
            });
          }}
        >
          {tablesFor(target).map((t) => (
            <option key={t.key} value={t.key}>
              {locale === "en" ? t.labelEn : t.labelJa}
            </option>
          ))}
        </select>
      </label>

      {/* 出す列。チェックで出し入れし、▲▼で並べ替える */}
      <div className="space-y-1">
        <p className="text-sm">{m.docEditor.tableColumns}</p>
        <ul className="space-y-1">
          {ordered.map((key) => {
            const on = b.columns.includes(key);
            const at = b.columns.indexOf(key);
            return (
              <li key={key} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    onChange({
                      ...b,
                      // 足すときは末尾へ。並べ替えは▲▼で行う
                      columns: e.target.checked
                        ? [...b.columns, key]
                        : b.columns.filter((k) => k !== key),
                    })
                  }
                />
                <span className={cn("w-44", !on && "text-muted-foreground")}>{labelOf(key)}</span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={!on || at <= 0}
                  aria-label={`${m.docEditor.moveUp}: ${labelOf(key)}`}
                  title={m.docEditor.moveUp}
                  onClick={() => move(key, -1)}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={!on || at < 0 || at >= b.columns.length - 1}
                  aria-label={`${m.docEditor.moveDown}: ${labelOf(key)}`}
                  title={m.docEditor.moveDown}
                  onClick={() => move(key, 1)}
                >
                  <ChevronDown className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground text-xs">{m.docEditor.tableColumnsHint}</p>
      </div>

      {/* 絞り込み。すべてに当てはまる行だけを出す */}
      <div className="space-y-1 border-t pt-2">
        <p className="text-sm">{m.docEditor.tableFilters}</p>
        {filters.map((f, k) => (
          <div key={k} className="flex flex-wrap items-center gap-1 text-sm">
            <select
              className={cn(SELECT, "w-40")}
              aria-label={m.docEditor.tableFilterColumn}
              value={f.column}
              onChange={(e) => {
                const next = [...filters];
                next[k] = { ...f, column: e.target.value };
                onChange({ ...b, filters: next });
              }}
            >
              {all.map((c) => (
                <option key={c.key} value={c.key}>
                  {locale === "en" ? c.labelEn : c.labelJa}
                </option>
              ))}
            </select>
            <select
              className={cn(SELECT, "w-32")}
              aria-label={m.docEditor.tableFilterOp}
              value={f.op}
              onChange={(e) => {
                const next = [...filters];
                next[k] = { ...f, op: e.target.value as TableFilterOp };
                onChange({ ...b, filters: next });
              }}
            >
              {TABLE_FILTER_OPS.map((op) => (
                <option key={op} value={op}>
                  {m.docEditor.tableFilterOps[op]}
                </option>
              ))}
            </select>
            {/* 空かどうかを見る条件では、打つ値が無い */}
            {f.op !== "empty" && f.op !== "notEmpty" && (
              <Input
                className="h-8 w-48"
                aria-label={m.docEditor.tableFilterValue}
                value={f.value ?? ""}
                onChange={(e) => {
                  const next = [...filters];
                  next[k] = { ...f, value: e.target.value };
                  onChange({ ...b, filters: next });
                }}
              />
            )}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={m.common.delete}
              title={m.common.delete}
              onClick={() => onChange({ ...b, filters: filters.filter((_, j) => j !== k) })}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={all.length === 0}
          onClick={() =>
            onChange({
              ...b,
              filters: [...filters, { column: all[0]!.key, op: "contains", value: "" }],
            })
          }
        >
          {m.docEditor.tableAddFilter}
        </Button>
      </div>

      {/* 置き換え。紙面に出る文字だけを整える */}
      <div className="space-y-1 border-t pt-2">
        <p className="text-sm">{m.docEditor.tableReplacements}</p>
        {replacements.map((r, k) => (
          <div key={k} className="flex flex-wrap items-center gap-1 text-sm">
            <select
              className={cn(SELECT, "w-40")}
              aria-label={m.docEditor.tableFilterColumn}
              value={r.column}
              onChange={(e) => {
                const next = [...replacements];
                next[k] = { ...r, column: e.target.value };
                onChange({ ...b, replacements: next });
              }}
            >
              {all.map((c) => (
                <option key={c.key} value={c.key}>
                  {locale === "en" ? c.labelEn : c.labelJa}
                </option>
              ))}
            </select>
            <Input
              className="h-8 w-48 font-mono"
              aria-label={m.docEditor.tablePattern}
              placeholder={m.docEditor.tablePattern}
              value={r.pattern}
              onChange={(e) => {
                const next = [...replacements];
                next[k] = { ...r, pattern: e.target.value };
                onChange({ ...b, replacements: next });
              }}
            />
            <span className="text-muted-foreground">→</span>
            <Input
              className="h-8 w-40"
              aria-label={m.docEditor.tableReplacement}
              placeholder={m.docEditor.tableReplacement}
              value={r.replacement}
              onChange={(e) => {
                const next = [...replacements];
                next[k] = { ...r, replacement: e.target.value };
                onChange({ ...b, replacements: next });
              }}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={m.common.delete}
              title={m.common.delete}
              onClick={() =>
                onChange({ ...b, replacements: replacements.filter((_, j) => j !== k) })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={all.length === 0}
          onClick={() =>
            onChange({
              ...b,
              replacements: [
                ...replacements,
                { column: all[0]!.key, pattern: "", replacement: "" },
              ],
            })
          }
        >
          {m.docEditor.tableAddReplacement}
        </Button>
        <p className="text-muted-foreground text-xs">{m.docEditor.tableReplacementHint}</p>
      </div>
    </div>
  );
}
