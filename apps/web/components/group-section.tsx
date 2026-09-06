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
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, GroupDto, ListResponse } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

/** 用途は節ごとに固定なので、並びは表示順だけでよい */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

interface Props {
  kind: GroupKind;
  title: string;
  hint: string;
  /** 端末に列幅・フィルターを覚えるための識別子（節ごとに分ける） */
  storageKey: string;
}

/**
 * グループ管理の1節（ニュースグループ / 所属）。
 * 用途ごとに使う人も並べ方も違うので、1つの表に混ぜず節を分けている。
 * 用途は節で決まるため、フォームにも表にも「用途」は出さない。
 */
export function GroupSection({ kind, title, hint, storageKey }: Props) {
  const { m, locale } = useI18n();

  const emptyForm = useMemo(
    () => ({ id: "", nameJa: "", nameEn: "", displayOrder: 0, activeFlag: true }),
    [],
  );
  const [form, setForm] = useState({ ...emptyForm });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<GroupDto>[]>(
    () => [
      {
        key: "nameJa",
        header: m.groups.nameJa,
        kind: "text",
        width: 240,
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
        width: 80,
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

  // 1画面に表が2つあるので、URLのクエリを用途ごとに分ける
  const { state, setState, ready } = useTableState(
    storageKey,
    columns,
    DEFAULT_STATE,
    kind.toLowerCase(),
  );
  const [data, setData] = useState<ListResponse<GroupDto> | null>(null);

  // 用途は利用者が変えられない条件なので、画面の状態とは別にここで足す
  const query = useMemo(() => {
    const params = serializeTableState(state, DEFAULT_STATE);
    params.set("f.kind", `in:${kind}`);
    return params.toString();
  }, [state, kind]);

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
          kind,
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
      setForm({ ...emptyForm });
      void load();
    } finally {
      setSaving(false);
    }
  }

  /** 確認は共通テーブル側で出す。使用中のものはサーバーが 409 で断る */
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
      if (form.id === g.id) setForm({ ...emptyForm });
    }
    void load();
  }

  const fieldId = (name: string) => `${kind.toLowerCase()}-${name}`;

  return (
    <section className="space-y-3">
      <p className="text-muted-foreground text-sm">{hint}</p>

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
                <Label htmlFor={fieldId("nameJa")}>{m.groups.nameJa}</Label>
                <Input
                  id={fieldId("nameJa")}
                  value={form.nameJa}
                  maxLength={100}
                  required
                  onChange={(e) => setForm({ ...form, nameJa: e.target.value })}
                  className="w-56"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={fieldId("nameEn")}>
                  {m.groups.nameEn}
                  <span className="text-muted-foreground">{m.common.optional}</span>
                </Label>
                <Input
                  id={fieldId("nameEn")}
                  value={form.nameEn}
                  maxLength={100}
                  onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                  className="w-56"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={fieldId("order")}>{m.groups.displayOrder}</Label>
                <Input
                  id={fieldId("order")}
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
            <p className="text-muted-foreground text-xs">{m.groups.displayOrderHint}</p>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? m.common.saving : m.common.save}
              </Button>
              {form.id !== "" && (
                <Button type="button" variant="outline" onClick={() => setForm({ ...emptyForm })}>
                  {m.common.discard}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <DataTable
        title={title}
        storageKey={storageKey}
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(g) => g.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={m.groups.empty}
        selectable
        onDeleteSelected={onDeleteSelected}
        // この画面は詳細を別に持たないので、鉛筆で上のフォームに読み込む
        rowAction={{
          onClick: (g) => {
            setForm({
              id: g.id,
              nameJa: g.nameJa,
              nameEn: g.nameEn ?? "",
              displayOrder: g.displayOrder,
              activeFlag: g.activeFlag,
            });
          },
        }}
      />
    </section>
  );
}
