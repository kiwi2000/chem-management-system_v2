"use client";

import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { FieldError } from "@/components/field-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { firstError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, PrtrGroupDto, PrtrSiteDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

const STORAGE_KEY = "chem.table.prtrSites";
const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

const EMPTY_FORM = { id: "", code: "", nameJa: "", nameEn: "", groupId: "", note: "" };

/**
 * 工場（S22-1）。項目が少ないので、一覧の上のフォームで足す・直す（マスタの作り分けの決まり）。
 * 行末の鉛筆で直し、先頭のチェックでまとめて消す
 */
export function PrtrSiteSection() {
  const { m, locale } = useI18n();
  const t = m.prtr.sites;
  const [data, setData] = useState<ListResponse<PrtrSiteDto> | null>(null);
  const [groups, setGroups] = useState<PrtrGroupDto[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<PrtrSiteDto>[]>(
    () => [
      {
        key: "code",
        header: t.code,
        kind: "text",
        width: 120,
        className: "font-mono text-xs",
        render: (s) => s.code,
      },
      {
        key: "nameJa",
        header: t.name,
        kind: "text",
        width: 240,
        render: (s) => pickName(locale, s.nameJa, s.nameEn),
      },
      {
        key: "groupId",
        header: t.group,
        kind: "enum",
        width: 200,
        options: groups.map((g) => ({ value: g.id, label: pickName(locale, g.nameJa, g.nameEn) })),
        render: (s) => (
          <>
            <span className="text-muted-foreground mr-2 font-mono text-xs">{s.groupCode}</span>
            {pickName(locale, s.groupNameJa, s.groupNameEn)}
          </>
        ),
      },
      {
        key: "userCount",
        header: t.userCount,
        kind: "number",
        width: 80,
        sortable: false,
        filterable: false,
        className: "text-right text-xs",
        render: (s) => String(s.userCount),
      },
      {
        key: "note",
        header: t.note,
        kind: "text",
        width: 320,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-xs",
        render: (s) => s.note ?? "",
      },
    ],
    [t, locale, groups],
  );

  const { state, setState } = useTableState(STORAGE_KEY, columns, DEFAULT_STATE);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(
      `/api/prtr/sites?${serializeTableState(state, DEFAULT_STATE).toString()}`,
    ).catch(() => null);
    if (!res?.ok) {
      if (res) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
      }
      return;
    }
    setData((await res.json()) as ListResponse<PrtrSiteDto>);
  }, [state, m]);

  useEffect(() => {
    void load();
  }, [load]);

  // グループは件数が知れているので全部引く（絞り込みの選択肢とフォームの候補）
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/prtr/groups?size=500").catch(() => null);
      if (res?.ok) setGroups(((await res.json()) as ListResponse<PrtrGroupDto>).items);
    })();
  }, []);

  async function save() {
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const creating = form.id === "";
      const res = await fetch(creating ? "/api/prtr/sites" : `/api/prtr/sites/${form.id}`, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          nameJa: form.nameJa,
          nameEn: form.nameEn || null,
          groupId: form.groupId,
          note: form.note || null,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        setFieldErrors(toFieldErrors(body?.error.details));
        return;
      }
      setOpen(false);
      setForm({ ...EMPTY_FORM });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected(rows: PrtrSiteDto[]) {
    setError(null);
    for (const s of rows) {
      const res = await fetch(`/api/prtr/sites/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    await load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{t.title}</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">{t.lead}</p>
        </div>
        {!open && (
          <Button
            size="sm"
            onClick={() => {
              setForm({ ...EMPTY_FORM });
              setOpen(true);
            }}
          >
            {t.add}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {open && (
          <div className="border-border bg-muted/30 flex flex-wrap items-end gap-3 border p-3">
            <div className="w-32 space-y-1">
              <Label htmlFor="site-code">{t.code}</Label>
              <Input
                id="site-code"
                value={form.code}
                maxLength={50}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className="h-8 font-mono"
              />
              <FieldError message={fieldError("code")} />
            </div>
            <div className="w-64 space-y-1">
              <Label htmlFor="site-name">{t.name}</Label>
              <Input
                id="site-name"
                value={form.nameJa}
                maxLength={200}
                onChange={(e) => setForm({ ...form, nameJa: e.target.value })}
                className="h-8"
              />
              <FieldError message={fieldError("nameJa")} />
            </div>
            <div className="w-56 space-y-1">
              <Label htmlFor="site-group">{t.group}</Label>
              <select
                id="site-group"
                value={form.groupId}
                onChange={(e) => setForm({ ...form, groupId: e.target.value })}
                className="border-input bg-background h-8 w-full rounded-none border px-2 text-sm"
              >
                <option value="">—</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} {pickName(locale, g.nameJa, g.nameEn)}
                  </option>
                ))}
              </select>
              <FieldError message={fieldError("groupId")} />
            </div>
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="site-note">{t.note}</Label>
              <Input
                id="site-note"
                value={form.note}
                maxLength={2000}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="h-8"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={
                  saving ||
                  form.code.trim() === "" ||
                  form.nameJa.trim() === "" ||
                  form.groupId === ""
                }
                onClick={() => void save()}
              >
                {saving ? m.common.saving : m.common.save}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                {m.common.cancel}
              </Button>
            </div>
          </div>
        )}
        <DataTable
          storageKey={STORAGE_KEY}
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(s) => s.id}
          total={data?.total ?? 0}
          state={state}
          defaultState={DEFAULT_STATE}
          onStateChange={setState}
          emptyMessage={t.empty}
          selectable
          onDeleteSelected={(rows) => void removeSelected(rows)}
          rowAction={{
            onClick: (s) => {
              setForm({
                id: s.id,
                code: s.code,
                nameJa: s.nameJa,
                nameEn: s.nameEn ?? "",
                groupId: s.groupId,
                note: s.note ?? "",
              });
              setOpen(true);
            },
          }}
        />
      </CardContent>
    </Card>
  );
}
