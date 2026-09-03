"use client";

import { emptyTableState, SOURCE_MARK_MAX, type TableState } from "@chem/shared";
import { Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { ColorPicker } from "@/components/color-picker";
import { SourceChip } from "@/components/source-chip";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, LinkVersionSourceDto, ListResponse, SourceDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

// 件数が知れているので1ページに全部出し、ページ送りは置かない
const DEFAULT_STATE: TableState = {
  ...emptyTableState([{ column: "priority", direction: "asc" }]),
  pageSize: 200,
};

const SELECT_CLASS = "border-input bg-background h-9 w-full rounded-none border px-2 text-sm";

/**
 * データソース（バージョン × データソース種別）。
 *
 * 登録するのは3つだけ。バージョン・種別・説明。
 * 優先度は登録のときに末尾へ付き、あとから上下の矢印で並べ替える
 * （数字を打たせると、同じバージョンの中でぶつかるため）。
 *
 * 取り込みも手入力も、この行があってはじめてできる。
 */
export function DataSourceSection({
  versionId,
  versionCode,
  reloadToken,
}: {
  /** 左で選んでいるバージョン。決まるまでは表を出さない */
  versionId: string | null;
  versionCode: string | null;
  reloadToken: number;
}) {
  const { m, locale } = useI18n();
  const ask = useConfirm();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [items, setItems] = useState<LinkVersionSourceDto[] | null>(null);
  const [sources, setSources] = useState<SourceDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** 登録の欄。開いているときだけ出す */
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ sourceId: "", note: "" });
  /** 説明だけは行の中で直せる */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /** 印に出す文字。押すと入力欄になる */
  const [markEditingId, setMarkEditingId] = useState<string | null>(null);
  const [mark, setMark] = useState("");

  const columns = useMemo<TableColumn<LinkVersionSourceDto>[]>(
    () => [
      {
        key: "sourceCode",
        header: m.dataSources.source,
        kind: "text",
        width: 116,
        sortable: false,
        filterable: false,
        className: "font-mono text-xs",
        render: (r) => r.sourceCode,
      },
      {
        /*
          色。**種別そのものの持ちものなので、どのバージョンでも同じ色**になる。
          ここで変えると、ほかのバージョンの同じ種別も変わる
        */
        key: "sourceColor",
        header: m.sources.color,
        kind: "text",
        width: 52,
        sortable: false,
        filterable: false,
        className: "text-center",
        render: (r) => (
          <ColorPicker
            value={r.sourceColor}
            disabled={!editable}
            label={m.sources.colorPick}
            clearLabel={m.sources.colorNone}
            customLabel={m.sources.colorCustom}
            locale={locale}
            onChange={(color) => void saveColor(r, color)}
          />
        ),
      },
      {
        /*
          印に出す文字。**1文字とは限らない。**
          決めていなければコードの頭文字を使うので、空でも困らない
        */
        key: "sourceMark",
        header: m.sources.mark,
        kind: "text",
        width: 96,
        sortable: false,
        filterable: false,
        render: (r) =>
          r.id === markEditingId ? (
            <Input
              // 押してすぐ打てるようにする。もう一度押させると、直すたびに2手かかる
              autoFocus
              value={mark}
              maxLength={SOURCE_MARK_MAX}
              aria-label={m.sources.mark}
              onChange={(e) => setMark(e.target.value)}
              onBlur={() => void saveMark(r)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveMark(r);
                if (e.key === "Escape") setMarkEditingId(null);
              }}
              className="h-7 w-full text-sm"
            />
          ) : (
            <button
              type="button"
              disabled={!editable}
              title={m.sources.markEdit}
              onClick={() => {
                setMarkEditingId(r.id);
                setMark(r.sourceMark ?? "");
              }}
              className="flex items-center gap-1.5"
            >
              <SourceChip
                source={{
                  id: r.sourceId,
                  code: r.sourceCode,
                  color: r.sourceColor,
                  mark: r.sourceMark,
                }}
              />
              {/* 印は必須。空のものは赤字で知らせ、押して入れてもらう */}
              {!r.sourceMark && (
                <span className="text-destructive text-xs">{m.sources.markMissing}</span>
              )}
            </button>
          ),
      },
      {
        key: "note",
        header: m.dataSources.note,
        kind: "text",
        width: 320,
        sortable: false,
        filterable: false,
        render: (r) =>
          r.id === editingId ? (
            <Input
              value={note}
              maxLength={2000}
              aria-label={m.dataSources.note}
              onChange={(e) => setNote(e.target.value)}
              className="h-7 w-full text-sm"
            />
          ) : (
            (r.note ?? "")
          ),
      },
      {
        key: "linkCount",
        header: m.dataSources.linkCount,
        kind: "number",
        width: 88,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-right text-xs",
        render: (r) => r.linkCount.toLocaleString(locale),
      },
      {
        key: "loadedAt",
        header: m.dataSources.loadedAt,
        kind: "date",
        width: 120,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => (r.loadedAt ? new Date(r.loadedAt).toLocaleDateString(locale) : ""),
      },
      {
        // 取り込みは行ごとの操作。見出しは要らないのでアイコンだけ置く
        key: "import",
        header: "",
        kind: "text",
        width: 56,
        sortable: false,
        filterable: false,
        className: "text-center",
        render: () => (
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            title={m.dataSources.importFile}
            aria-label={m.dataSources.importFile}
            onClick={(e) => {
              e.stopPropagation();
              // 取り込みはこれから作る
              void ask({ message: m.common.underConstruction, confirmLabel: m.common.ok });
            }}
          >
            <Upload className="size-3.5" />
          </Button>
        ),
      },
    ],
    // saveColor は毎回作られるが、中身は変わらないので手がかりに入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, locale, editingId, note, markEditingId, mark, editable, sources],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.dataSources",
    columns,
    DEFAULT_STATE,
  );

  const load = useCallback(async () => {
    if (!versionId) {
      setItems([]);
      return;
    }
    setError(null);
    const res = await fetch("/api/link-version-sources?versionId=" + versionId);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setItems([]);
      return;
    }
    setItems(((await res.json()) as ListResponse<LinkVersionSourceDto>).items);
  }, [m, versionId]);

  /** 登録の欄で選ばせるので、種別は全部引いておく（件数が知れている） */
  const loadChoices = useCallback(async () => {
    const s = await fetch("/api/sources?size=200").catch(() => null);
    if (s?.ok) setSources(((await s.json()) as ListResponse<SourceDto>).items);
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load, reloadToken]);

  useEffect(() => {
    void loadChoices();
  }, [loadChoices, reloadToken]);

  async function add() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/link-version-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, sourceId: form.sourceId, note: form.note || null }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setAdding(false);
      setForm({ sourceId: "", note: "" });
      void load();
    } finally {
      setSaving(false);
    }
  }

  /**
   * 色を保存する。**書き換えるのは種別そのもの**（`/api/sources`）で、
   * バージョン × 種別の行ではない。どのバージョンでも同じ色にするため。
   *
   * 保存できたら、いま出している行にもその場で反映する。
   * 引き直すと、開いている選択の欄が閉じて選んだ手応えが消える
   */
  async function saveColor(row: LinkVersionSourceDto, color: string | null) {
    // 印が必須になったので、無いまま色だけ直すと保存できない。先に印を入れてもらう
    if (!row.sourceMark) {
      setError(m.sources.markFirst);
      return;
    }
    const type = sources.find((x) => x.id === row.sourceId);
    if (!type) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/sources/" + row.sourceId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: type.code, note: type.note, color, mark: type.mark }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      // 同じ種別の行はまとめて塗り替える
      setItems(
        (prev) =>
          prev?.map((r) => (r.sourceId === row.sourceId ? { ...r, sourceColor: color } : r)) ??
          prev,
      );
      setSources((prev) => prev.map((x) => (x.id === row.sourceId ? { ...x, color } : x)));
    } finally {
      setSaving(false);
    }
  }

  /** 印に出す文字を保存する。色と同じく、書き換えるのは種別そのもの */
  async function saveMark(row: LinkVersionSourceDto) {
    const type = sources.find((x) => x.id === row.sourceId);
    // 空では保存しない（印は必須）。入力欄は開いたままにして、赤字で知らせる
    if (!mark.trim()) {
      setError(m.validation.required);
      return;
    }
    setMarkEditingId(null);
    if (!type || (row.sourceMark ?? "") === mark.trim()) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/sources/" + row.sourceId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: type.code, note: type.note, color: type.color, mark }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const saved = mark.trim() || null;
      setItems(
        (prev) =>
          prev?.map((x) => (x.sourceId === row.sourceId ? { ...x, sourceMark: saved } : x)) ?? prev,
      );
      setSources((prev) => prev.map((x) => (x.id === row.sourceId ? { ...x, mark: saved } : x)));
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    const target = items?.find((r) => r.id === editingId);
    if (!target) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/link-version-sources/" + target.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: target.versionId,
          sourceId: target.sourceId,
          note: note || null,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setEditingId(null);
      void load();
    } finally {
      setSaving(false);
    }
  }

  /** 並べ替え。番号は出さず、並んでいる順そのものが順位になる */
  async function reorder(fromKey: string, toKey: string) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/link-version-sources/" + fromKey + "/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: toKey }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteSelected(targets: LinkVersionSourceDto[]) {
    setError(null);
    for (const r of targets) {
      const res = await fetch("/api/link-version-sources/" + r.id, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (selectedId === r.id) setSelectedId(null);
    }
    void load();
  }

  const canAdd = versionId !== null && form.sourceId !== "";

  return (
    <section className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 登録の欄。3つ選んで押すだけなので、1行に収める */}
      {adding && (
        <div className="border-border bg-muted/30 flex flex-wrap items-end gap-3 border p-3">
          <div className="w-48 space-y-1">
            <Label htmlFor="ds-source">{m.dataSources.source}</Label>
            <select
              id="ds-source"
              value={form.sourceId}
              onChange={(e) => setForm({ ...form, sourceId: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">{m.dataSources.selectSource}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                  {s.note ? " — " + s.note : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="ds-note">{m.dataSources.note}</Label>
            <Input
              id="ds-note"
              maxLength={2000}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!canAdd || saving} onClick={() => void add()}>
              {saving ? m.common.saving : m.common.save}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
              {m.common.cancel}
            </Button>
          </div>
        </div>
      )}

      <DataTable
        title={
          <>
            {m.dataSources.title}
            {/* どのバージョンの中身を見ているかは間違えやすいので、はっきり出す */}
            {versionCode && (
              <span className="bg-primary text-primary-foreground ml-2 rounded px-2 py-0.5 align-middle font-mono text-sm">
                {versionCode}
              </span>
            )}
          </>
        }
        // 末尾の版を上げると、覚えている列幅を捨てて既定から始め直す（既定の幅を広げた）
        storageKey="chem.table.dataSources.v2"
        columns={columns}
        rows={items}
        rowKey={(r) => r.id}
        total={items?.length ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.dataSources.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        showPager={false}
        showFilters={false}
        selectedKey={selectedId}
        onRowSelect={(r) => setSelectedId(r.id)}
        onReorder={reorder}
        create={editable && !adding && !editingId ? { onClick: () => setAdding(true) } : undefined}
        headerActions={
          editable ? (
            editingId ? (
              <div className="flex gap-2">
                <Button size="sm" disabled={saving} onClick={() => void saveNote()}>
                  {saving ? m.common.saving : m.common.save}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                  {m.common.cancel}
                </Button>
              </div>
            ) : undefined
          ) : undefined
        }
        // 編集は行の右端の鉛筆から
        rowAction={
          editable
            ? {
                onClick: (r) => {
                  setEditingId(r.id);
                  setNote(r.note ?? "");
                },
                disabled: () => adding,
              }
            : undefined
        }
      />
    </section>
  );
}
