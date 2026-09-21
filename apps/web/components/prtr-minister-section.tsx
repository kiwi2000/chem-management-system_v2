"use client";

import { emptyTableState, type TableState } from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { FieldError } from "@/components/field-error";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { firstError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, PrtrMinisterDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

const STORAGE_KEY = "chem.table.prtrMinisters";
const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

const EMPTY_FORM = { id: "", name: "", active: true };

/** 主務大臣（S22-1）。届出先。項目が少ないので一覧の上のフォームで足す・直す */
export function PrtrMinisterSection() {
  const { m } = useI18n();
  const t = m.prtr.ministers;
  const [items, setItems] = useState<PrtrMinisterDto[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<PrtrMinisterDto>[]>(
    () => [
      {
        key: "name",
        header: t.name,
        kind: "text",
        width: 240,
        sortable: false,
        filterable: false,
        render: (x) => x.name,
      },
      {
        key: "industryCount",
        header: t.industryCount,
        kind: "number",
        width: 160,
        sortable: false,
        filterable: false,
        className: "text-right text-xs",
        render: (x) => String(x.industryCount),
      },
      {
        key: "active",
        header: t.active,
        kind: "enum",
        width: 72,
        sortable: false,
        filterable: false,
        className: "text-center",
        render: (x) => (
          <StatusIcon
            active={x.active}
            activeLabel={m.users.active}
            inactiveLabel={m.users.inactive}
          />
        ),
      },
    ],
    [t, m],
  );

  const { state, setState } = useTableState(STORAGE_KEY, columns, DEFAULT_STATE);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/prtr/ministers").catch(() => null);
    if (!res?.ok) {
      if (res) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
      }
      return;
    }
    setItems(((await res.json()) as ListResponse<PrtrMinisterDto>).items);
  }, [m]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const creating = form.id === "";
      const res = await fetch(creating ? "/api/prtr/ministers" : `/api/prtr/ministers/${form.id}`, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, active: form.active }),
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

  async function removeSelected(rows: PrtrMinisterDto[]) {
    setError(null);
    for (const x of rows) {
      const res = await fetch(`/api/prtr/ministers/${x.id}`, { method: "DELETE" });
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
            <div className="w-64 space-y-1">
              <Label htmlFor="min-name">{t.name}</Label>
              <Input
                id="min-name"
                value={form.name}
                maxLength={100}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-8"
              />
              <FieldError message={fieldError("name")} />
            </div>
            <label className="flex h-8 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              {t.active}
            </label>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={saving || form.name.trim() === ""}
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
          rows={items}
          rowKey={(x) => x.id}
          total={items.length}
          state={state}
          defaultState={DEFAULT_STATE}
          onStateChange={setState}
          emptyMessage={t.empty}
          showPager={false}
          showFilters={false}
          selectable
          onDeleteSelected={(rows) => void removeSelected(rows)}
          rowAction={{
            onClick: (x) => {
              setForm({ id: x.id, name: x.name, active: x.active });
              setOpen(true);
            },
          }}
        />
      </CardContent>
    </Card>
  );
}
