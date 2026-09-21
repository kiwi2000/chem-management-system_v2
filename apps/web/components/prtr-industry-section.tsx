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
import type { ApiError, ListResponse, PrtrIndustryDto, PrtrMinisterDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

const STORAGE_KEY = "chem.table.prtrIndustries";
const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

const EMPTY_FORM = { id: "", code: "", name: "", defaultMinisterId: "", active: true };

/**
 * 業種（S22-1）。届出書の本紙で選ぶ。既定として届出の手引きの一覧が入っている。
 * 項目が少ないので一覧の上のフォームで足す・直す。件数が知れているので絞り込みは持たない
 */
export function PrtrIndustrySection() {
  const { m } = useI18n();
  const t = m.prtr.industries;
  const [items, setItems] = useState<PrtrIndustryDto[]>([]);
  const [ministers, setMinisters] = useState<PrtrMinisterDto[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<PrtrIndustryDto>[]>(
    () => [
      {
        key: "code",
        header: t.code,
        kind: "text",
        width: 100,
        sortable: false,
        filterable: false,
        className: "font-mono text-xs",
        render: (i) => i.code,
      },
      {
        key: "name",
        header: t.name,
        kind: "text",
        width: 420,
        sortable: false,
        filterable: false,
        multiline: true,
        clampLines: 2,
        render: (i) => i.name,
      },
      {
        key: "minister",
        header: t.minister,
        kind: "text",
        width: 160,
        sortable: false,
        filterable: false,
        render: (i) => i.defaultMinisterName ?? t.ministerNone,
      },
      {
        key: "active",
        header: t.active,
        kind: "enum",
        width: 72,
        sortable: false,
        filterable: false,
        className: "text-center",
        render: (i) => (
          <StatusIcon
            active={i.active}
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
    const [a, b] = await Promise.all([
      fetch("/api/prtr/industries").catch(() => null),
      fetch("/api/prtr/ministers").catch(() => null),
    ]);
    if (!a?.ok) {
      if (a) {
        if (redirectIfUnauthorized(a)) return;
        const body = (await a.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(a.status));
      }
      return;
    }
    setItems(((await a.json()) as ListResponse<PrtrIndustryDto>).items);
    if (b?.ok) setMinisters(((await b.json()) as ListResponse<PrtrMinisterDto>).items);
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
      const res = await fetch(
        creating ? "/api/prtr/industries" : `/api/prtr/industries/${form.id}`,
        {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: form.code,
            name: form.name,
            defaultMinisterId: form.defaultMinisterId || null,
            active: form.active,
          }),
        },
      );
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

  async function removeSelected(rows: PrtrIndustryDto[]) {
    setError(null);
    for (const i of rows) {
      const res = await fetch(`/api/prtr/industries/${i.id}`, { method: "DELETE" });
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
            <div className="w-28 space-y-1">
              <Label htmlFor="ind-code">{t.code}</Label>
              <Input
                id="ind-code"
                value={form.code}
                maxLength={4}
                inputMode="numeric"
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className="h-8 font-mono"
              />
              <FieldError message={fieldError("code")} />
            </div>
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor="ind-name">{t.name}</Label>
              <Input
                id="ind-name"
                value={form.name}
                maxLength={200}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-8"
              />
              <FieldError message={fieldError("name")} />
            </div>
            <div className="w-48 space-y-1">
              <Label htmlFor="ind-minister">{t.minister}</Label>
              <select
                id="ind-minister"
                value={form.defaultMinisterId}
                onChange={(e) => setForm({ ...form, defaultMinisterId: e.target.value })}
                className="border-input bg-background h-8 w-full rounded-none border px-2 text-sm"
              >
                <option value="">{t.ministerNone}</option>
                {ministers
                  .filter((x) => x.active || x.id === form.defaultMinisterId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
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
                disabled={saving || form.code.trim() === "" || form.name.trim() === ""}
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
          rowKey={(i) => i.id}
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
            onClick: (i) => {
              setForm({
                id: i.id,
                code: i.code,
                name: i.name,
                defaultMinisterId: i.defaultMinisterId ?? "",
                active: i.active,
              });
              setOpen(true);
            },
          }}
        />
      </CardContent>
    </Card>
  );
}
