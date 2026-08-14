"use client";

import {
  emptyTableState,
  pickName,
  serializeTableState,
  type GroupKind,
  type TableState,
} from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, GroupDto, ListResponse } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

const selectClass = "border-input bg-background h-9 rounded-md border px-2 text-sm";

/** 用途ごとにまとめ、その中は表示順。お知らせの見出しの並びと同じ見え方になる */
const DEFAULT_STATE: TableState = emptyTableState([
  { column: "kind", direction: "asc" },
  { column: "displayOrder", direction: "asc" },
]);

/** 空のフォーム。新規追加と編集で同じ形を使う */
const EMPTY = {
  id: "",
  kind: "NEWS" as GroupKind,
  nameJa: "",
  nameEn: "",
  displayOrder: 0,
  activeFlag: true,
};

export default function GroupsPage() {
  const { m, locale } = useI18n();
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<GroupDto>[]>(
    () => [
      {
        key: "kind",
        header: m.groups.kind,
        kind: "enum",
        width: 150,
        options: [
          { value: "NEWS", label: m.groups.kindNews },
          { value: "ORG", label: m.groups.kindOrg },
        ],
        render: (g) => (g.kind === "NEWS" ? m.groups.kindNews : m.groups.kindOrg),
      },
      {
        key: "nameJa",
        header: m.groups.nameJa,
        kind: "text",
        width: 220,
        render: (g) => pickName(locale, g.nameJa, g.nameEn),
      },
      {
        key: "nameEn",
        header: m.groups.nameEn,
        kind: "text",
        width: 200,
        className: "text-muted-foreground",
        render: (g) => g.nameEn ?? "",
      },
      {
        key: "displayOrder",
        header: m.groups.displayOrder,
        kind: "number",
        width: 80,
        className: "text-muted-foreground text-right",
        render: (g) => g.displayOrder,
      },
      {
        key: "memberCount",
        header: m.groups.memberCount,
        kind: "number",
        width: 90,
        sortable: false,
        filterable: false,
        className: "text-right text-muted-foreground text-xs",
        render: (g) => m.groups.members(g.memberCount),
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
        render: (g) => (
          <StatusIcon
            active={g.activeFlag}
            activeLabel={m.users.active}
            inactiveLabel={m.users.inactive}
          />
        ),
      },
    ],
    [m, locale],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.groups",
    columns,
    DEFAULT_STATE,
  );
  const [data, setData] = useState<ListResponse<GroupDto> | null>(null);

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/groups?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<GroupDto>);
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
      const res = await fetch(editing ? `/api/admin/groups/${form.id}` : "/api/admin/groups", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          nameJa: form.nameJa,
          nameEn: form.nameEn || null,
          displayOrder: Number(form.displayOrder) || 0,
          activeFlag: form.activeFlag,
        }),
      });
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

  /** 確認は共通テーブル側で出す。使用中のグループはサーバーが 409 で断る */
  async function onDeleteSelected(targets: GroupDto[]) {
    setError(null);
    for (const g of targets) {
      const res = await fetch(`/api/admin/groups/${g.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (form.id === g.id) setForm({ ...EMPTY });
    }
    void load();
  }

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{m.groups.title}</h1>
      <p className="text-muted-foreground text-sm">{m.groups.description}</p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {form.id ? m.groups.editTitle : m.groups.newTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="kind">{m.groups.kind}</Label>
                <select
                  id="kind"
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as GroupKind })}
                  className={selectClass}
                >
                  <option value="NEWS">{m.groups.kindNews}</option>
                  <option value="ORG">{m.groups.kindOrg}</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nameJa">{m.groups.nameJa}</Label>
                <Input
                  id="nameJa"
                  value={form.nameJa}
                  maxLength={100}
                  required
                  onChange={(e) => setForm({ ...form, nameJa: e.target.value })}
                  className="w-56"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nameEn">
                  {m.groups.nameEn}
                  <span className="text-muted-foreground">{m.common.optional}</span>
                </Label>
                <Input
                  id="nameEn"
                  value={form.nameEn}
                  maxLength={100}
                  onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                  className="w-56"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="order">{m.groups.displayOrder}</Label>
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
                {m.groups.activeFlag}
              </label>
            </div>
            <p className="text-muted-foreground text-xs">
              {form.kind === "NEWS" ? m.groups.kindNewsHint : m.groups.kindOrgHint} /{" "}
              {m.groups.displayOrderHint}
            </p>
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
        storageKey="chem.table.groups"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(g) => g.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.groups.empty}
        selectable
        onDeleteSelected={onDeleteSelected}
        // この画面は詳細を別に持たないので、ダブルクリックで上のフォームに読み込む
        onRowActivate={(g) => {
          setForm({
            id: g.id,
            kind: g.kind,
            nameJa: g.nameJa,
            nameEn: g.nameEn ?? "",
            displayOrder: g.displayOrder,
            activeFlag: g.activeFlag,
          });
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </div>
  );
}
