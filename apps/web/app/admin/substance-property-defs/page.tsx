"use client";

import {
  emptyTableState,
  pickName,
  serializeTableState,
  type PropertyDataType,
  type TableState,
} from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, PropertyDefDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

const selectClass = "border-input bg-background h-9 rounded-md border px-2 text-sm";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** 空のフォーム。新規追加と編集で同じ形を使う */
const EMPTY = {
  id: "",
  key: "",
  labelJa: "",
  labelEn: "",
  dataType: "TEXT" as PropertyDataType,
  defaultUnit: "",
  displayOrder: 0,
  activeFlag: true,
};

export default function PropertyDefsPage() {
  const { m, locale } = useI18n();
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<PropertyDefDto>[]>(
    () => [
      {
        key: "displayOrder",
        header: m.propertyDefs.displayOrder,
        kind: "number",
        width: 72,
        className: "text-muted-foreground text-right",
        render: (d) => d.displayOrder,
      },
      {
        key: "key",
        header: m.propertyDefs.key,
        kind: "text",
        width: 180,
        className: "font-mono text-xs",
        render: (d) => d.key,
      },
      {
        key: "labelJa",
        header: m.propertyDefs.labelJa,
        kind: "text",
        width: 280,
        render: (d) => (
          <>
            {pickName(locale, d.labelJa, d.labelEn)}
            {d.valueCount > 0 && (
              <span className="text-muted-foreground ml-2 text-xs">
                {m.propertyDefs.valueCount(d.valueCount)}
              </span>
            )}
          </>
        ),
      },
      {
        key: "dataType",
        header: m.propertyDefs.dataType,
        kind: "enum",
        width: 100,
        options: [
          { value: "TEXT", label: m.propertyDefs.typeText },
          { value: "NUMBER", label: m.propertyDefs.typeNumber },
        ],
        render: (d) =>
          d.dataType === "NUMBER" ? m.propertyDefs.typeNumber : m.propertyDefs.typeText,
      },
      {
        key: "defaultUnit",
        header: m.propertyDefs.defaultUnit,
        kind: "text",
        width: 100,
        render: (d) => d.defaultUnit ?? "",
      },
      {
        key: "activeFlag",
        header: m.common.activeHeader,
        kind: "enum",
        width: 64,
        className: "text-center",
        options: [
          { value: "true", label: m.users.active },
          { value: "false", label: m.users.inactive },
        ],
        render: (d) => (
          <StatusIcon
            active={d.activeFlag}
            activeLabel={m.users.active}
            inactiveLabel={m.users.inactive}
          />
        ),
      },
    ],
    [m, locale],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.propertyDefs",
    columns,
    DEFAULT_STATE,
  );
  const [data, setData] = useState<ListResponse<PropertyDefDto> | null>(null);

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/substance-property-defs?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<PropertyDefDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const editing = form.id !== "";
      const res = await fetch(
        editing
          ? `/api/admin/substance-property-defs/${form.id}`
          : "/api/admin/substance-property-defs",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: form.key,
            labelJa: form.labelJa,
            labelEn: form.labelEn || null,
            dataType: form.dataType,
            defaultUnit: form.defaultUnit || null,
            displayOrder: Number(form.displayOrder) || 0,
            activeFlag: form.activeFlag,
          }),
        },
      );
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setForm({ ...EMPTY });
      void load();
    } finally {
      setSaving(false);
    }
  }

  /** 確認は共通テーブル側で出す（入力済みの値も消える点は画面の説明で伝える） */
  async function onDeleteSelected(targets: PropertyDefDto[]) {
    setError(null);
    for (const d of targets) {
      const res = await fetch(`/api/admin/substance-property-defs/${d.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (form.id === d.id) setForm({ ...EMPTY });
    }
    void load();
  }

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{m.propertyDefs.title}</h1>
      <p className="text-muted-foreground text-sm">{m.propertyDefs.description}</p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {form.id ? m.propertyDefs.editTitle : m.propertyDefs.newTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Label htmlFor="key">{m.propertyDefs.key}</Label>
                <Input
                  id="key"
                  required
                  maxLength={50}
                  disabled={form.id !== ""}
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  className="w-48 font-mono"
                  placeholder="melting_point"
                />
                <p className="text-muted-foreground text-xs">{m.propertyDefs.keyHint}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="labelJa">{m.propertyDefs.labelJa}</Label>
                <Input
                  id="labelJa"
                  required
                  maxLength={100}
                  value={form.labelJa}
                  onChange={(e) => setForm({ ...form, labelJa: e.target.value })}
                  className="w-56"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="labelEn">
                  {m.propertyDefs.labelEn}
                  {m.common.optional}
                </Label>
                <Input
                  id="labelEn"
                  maxLength={100}
                  value={form.labelEn}
                  onChange={(e) => setForm({ ...form, labelEn: e.target.value })}
                  className="w-56"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="dataType">{m.propertyDefs.dataType}</Label>
                <select
                  id="dataType"
                  value={form.dataType}
                  onChange={(e) =>
                    setForm({ ...form, dataType: e.target.value as PropertyDataType })
                  }
                  className={selectClass}
                >
                  <option value="TEXT">{m.propertyDefs.typeText}</option>
                  <option value="NUMBER">{m.propertyDefs.typeNumber}</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">
                  {m.propertyDefs.defaultUnit}
                  {m.common.optional}
                </Label>
                <Input
                  id="unit"
                  maxLength={50}
                  value={form.defaultUnit}
                  onChange={(e) => setForm({ ...form, defaultUnit: e.target.value })}
                  className="w-28"
                  placeholder="℃"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="order">{m.propertyDefs.displayOrder}</Label>
                <Input
                  id="order"
                  type="number"
                  min={0}
                  max={9999}
                  value={form.displayOrder}
                  onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })}
                  className="w-24"
                />
              </div>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.activeFlag}
                  onChange={(e) => setForm({ ...form, activeFlag: e.target.checked })}
                />
                {m.propertyDefs.activeFlag}
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? m.common.saving : m.common.save}
              </Button>
              {form.id !== "" && (
                <Button type="button" variant="outline" onClick={() => setForm({ ...EMPTY })}>
                  {m.common.cancel}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <DataTable
        storageKey="chem.table.propertyDefs"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(d) => d.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.propertyDefs.empty}
        selectable
        onDeleteSelected={onDeleteSelected}
        // この画面は詳細を別に持たないので、ダブルクリックで上のフォームに読み込む
        onRowActivate={(d) => {
          setForm({
            id: d.id,
            key: d.key,
            labelJa: d.labelJa,
            labelEn: d.labelEn ?? "",
            dataType: d.dataType,
            defaultUnit: d.defaultUnit ?? "",
            displayOrder: d.displayOrder,
            activeFlag: d.activeFlag,
          });
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </div>
  );
}
