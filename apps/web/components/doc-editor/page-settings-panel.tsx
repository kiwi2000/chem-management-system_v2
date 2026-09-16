"use client";

import {
  DEFAULT_BAND_SIZE,
  DEFAULT_PAGE_MARGIN_MM,
  DEFAULT_TITLE_SIZE,
  PAGE_BAND_VARS,
  PAGE_BORDER_STYLES,
  pageMarginOf,
  type PageBand,
  type PageBorder,
  type PageSettings,
  type PageTitle,
} from "@chem/shared";
import { Labeled } from "@/components/doc-editor/block-list";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-client";

const SELECT = "border-input h-7 rounded-none border bg-transparent px-2 text-sm";
const NUM = "border-input h-7 w-16 rounded-none border bg-transparent px-1 text-right text-sm";
const TEXT = "border-input h-7 rounded-none border bg-transparent px-2 text-sm";

/** 空の入れものは残さない（保存した様式に空の設定を残さない） */
function prune(page: PageSettings): PageSettings | undefined {
  const out: PageSettings = {};
  if (page.margin) out.margin = page.margin;
  if (page.border) out.border = page.border;
  if (page.title && page.title.text.trim() !== "") out.title = page.title;
  for (const key of ["header", "footer"] as const) {
    const band = page[key];
    if (!band) continue;
    const kept: PageBand = {};
    if (band.left?.trim()) kept.left = band.left;
    if (band.center?.trim()) kept.center = band.center;
    if (band.right?.trim()) kept.right = band.right;
    if (Object.keys(kept).length === 0) continue;
    if (band.startPage !== undefined && band.startPage > 1) kept.startPage = band.startPage;
    if (band.size !== undefined) kept.size = band.size;
    if (band.color) kept.color = band.color;
    out[key] = kept;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? fallback : n;
};

/**
 * 用紙の設定（余白・枠・タイトル・ヘッダー・フッター。2026-09-16 指示）。
 * ブロックの一覧の上に置く。開いたときだけ欄が出る
 */
export function PageSettingsPanel({
  value,
  onChange,
  editable,
}: {
  value: PageSettings | undefined;
  onChange: (next: PageSettings | undefined) => void;
  editable: boolean;
}) {
  const { m } = useI18n();
  const page = value ?? {};
  const set = (patch: Partial<PageSettings>) => onChange(prune({ ...page, ...patch }));
  const margin = pageMarginOf(page);
  const setMargin = (side: keyof typeof margin, v: string) =>
    set({ margin: { ...margin, [side]: Math.max(0, num(v, DEFAULT_PAGE_MARGIN_MM)) } });

  const border = page.border;
  const setBorder = (patch: Partial<PageBorder>) =>
    set({
      border: {
        style: "solid",
        widthMm: 0.3,
        color: "#000000",
        insetMm: 8,
        ...border,
        ...patch,
      },
    });

  const title = page.title;
  const setTitle = (patch: Partial<PageTitle>) => set({ title: { text: "", ...title, ...patch } });

  const bandEditor = (key: "header" | "footer", label: string) => {
    const band = page[key] ?? {};
    const setBand = (patch: Partial<PageBand>) => set({ [key]: { ...band, ...patch } });
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <div className="flex flex-wrap items-end gap-2">
          {(["left", "center", "right"] as const).map((pos) => (
            <Labeled key={pos} label={m.docEditor.bandPositions[pos]}>
              <Input
                className={`${TEXT} w-44`}
                disabled={!editable}
                value={band[pos] ?? ""}
                onChange={(e) => setBand({ [pos]: e.target.value })}
              />
            </Labeled>
          ))}
          <Labeled label={m.docEditor.bandStartPage}>
            <input
              type="number"
              min={1}
              step={1}
              className={NUM}
              disabled={!editable}
              value={band.startPage ?? 1}
              onChange={(e) =>
                setBand({ startPage: Math.max(1, Math.floor(num(e.target.value, 1))) })
              }
            />
          </Labeled>
          <Labeled label={m.docEditor.bandSize}>
            <input
              type="number"
              min={5}
              max={30}
              step={0.5}
              className={NUM}
              disabled={!editable}
              value={band.size ?? DEFAULT_BAND_SIZE}
              onChange={(e) => setBand({ size: num(e.target.value, DEFAULT_BAND_SIZE) })}
            />
          </Labeled>
          <Labeled label={m.docEditor.color}>
            <input
              type="color"
              className="h-7 w-9 cursor-pointer border-0 bg-transparent p-0"
              disabled={!editable}
              value={band.color ?? "#000000"}
              onChange={(e) => setBand({ color: e.target.value })}
            />
          </Labeled>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3 rounded-none border p-3">
      {/* 余白 */}
      <div className="flex flex-wrap items-end gap-2">
        <p className="mr-1 text-sm font-medium">{m.docEditor.pageMarginTitle}</p>
        {(["top", "right", "bottom", "left"] as const).map((side) => (
          <Labeled key={side} label={m.docEditor.marginSides[side]}>
            <input
              type="number"
              min={0}
              max={60}
              step={1}
              className={NUM}
              disabled={!editable}
              value={margin[side]}
              onChange={(e) => setMargin(side, e.target.value)}
            />
          </Labeled>
        ))}
      </div>

      {/* 枠 */}
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            disabled={!editable}
            checked={!!border}
            onChange={(e) =>
              e.target.checked ? setBorder({}) : onChange(prune({ ...page, border: undefined }))
            }
          />
          {m.docEditor.pageBorderOn}
        </label>
        {border && (
          <div className="flex flex-wrap items-end gap-2">
            <Labeled label={m.docEditor.borderStyle}>
              <select
                className={SELECT}
                disabled={!editable}
                value={border.style}
                onChange={(e) => setBorder({ style: e.target.value as PageBorder["style"] })}
              >
                {PAGE_BORDER_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {m.docEditor.borderStyles[s]}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label={m.docEditor.pageBorderWidth}>
              <input
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                className={NUM}
                disabled={!editable}
                value={border.widthMm}
                onChange={(e) => setBorder({ widthMm: Math.max(0.1, num(e.target.value, 0.3)) })}
              />
            </Labeled>
            <Labeled label={m.docEditor.color}>
              <input
                type="color"
                className="h-7 w-9 cursor-pointer border-0 bg-transparent p-0"
                disabled={!editable}
                value={border.color}
                onChange={(e) => setBorder({ color: e.target.value })}
              />
            </Labeled>
            <Labeled label={m.docEditor.borderInset}>
              <input
                type="number"
                min={0}
                max={60}
                step={1}
                className={NUM}
                disabled={!editable}
                value={border.insetMm}
                onChange={(e) => setBorder({ insetMm: Math.max(0, num(e.target.value, 8)) })}
              />
            </Labeled>
          </div>
        )}
      </div>

      {/* タイトル */}
      <div className="space-y-1">
        <p className="text-sm font-medium">{m.docEditor.pageTitle}</p>
        <div className="flex flex-wrap items-end gap-2">
          <Labeled label={m.docEditor.pageTitleText}>
            <Input
              className={`${TEXT} w-72`}
              disabled={!editable}
              value={title?.text ?? ""}
              onChange={(e) => setTitle({ text: e.target.value })}
            />
          </Labeled>
          <Labeled label={m.docEditor.size}>
            <input
              type="number"
              min={6}
              max={60}
              step={0.5}
              className={NUM}
              disabled={!editable}
              value={title?.size ?? DEFAULT_TITLE_SIZE}
              onChange={(e) => setTitle({ size: num(e.target.value, DEFAULT_TITLE_SIZE) })}
            />
          </Labeled>
          <label className="flex h-7 items-center gap-1 text-sm">
            <input
              type="checkbox"
              disabled={!editable}
              checked={title?.bold ?? true}
              onChange={(e) => setTitle({ bold: e.target.checked })}
            />
            {m.docEditor.bold}
          </label>
          <Labeled label={m.docEditor.color}>
            <input
              type="color"
              className="h-7 w-9 cursor-pointer border-0 bg-transparent p-0"
              disabled={!editable}
              value={title?.color ?? "#000000"}
              onChange={(e) => setTitle({ color: e.target.value })}
            />
          </Labeled>
          <Labeled label={m.docEditor.titleAlign}>
            <select
              className={SELECT}
              disabled={!editable}
              value={title?.align ?? "center"}
              onChange={(e) => setTitle({ align: e.target.value as PageTitle["align"] })}
            >
              <option value="left">{m.docEditor.alignLeft}</option>
              <option value="center">{m.docEditor.alignCenter}</option>
              <option value="right">{m.docEditor.alignRight}</option>
            </select>
          </Labeled>
        </div>
      </div>

      {bandEditor("header", m.docEditor.header)}
      {bandEditor("footer", m.docEditor.footer)}
      <p className="text-muted-foreground text-xs">
        {m.docEditor.bandVarsHint(PAGE_BAND_VARS.map((v) => `{${v.ja}}`).join(" "))}
        <br />
        {m.docEditor.bandStartPageHint}
      </p>
    </div>
  );
}
